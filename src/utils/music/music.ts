import { useEffect, useState } from "react";
import { SpotifyWebApi } from "spotify-web-api-ts";
import { SimplifiedAlbum } from "spotify-web-api-ts/types/types/SpotifyObjects";
import SpotifyPlayer from "spotify-web-playback";

import {
  authSpotifyWithRefreshToken,
  authWithCode,
  grantSpotifyPermissions,
} from "./spotifyAuth";
import { GenericAlbum, GenericTrack } from "./types";

const spotify = new SpotifyWebApi();
const player = new SpotifyPlayer("Song Sorter");
const fallbackAudio = new Audio();

export default class Music {
  public spotify = spotify;
  private spotifyToken?: string;
  private isPremium = false;
  private stateCallbacks: ((state: MusicState) => void)[] = [];

  public async authenticate() {
    const codeVerifier = localStorage.getItem("codeVerifier");
    const refreshToken = localStorage.getItem("refresh_id");
    const code = new URLSearchParams(window.location.search).get("code");
    window.history.replaceState({}, document.title, "/");

    // first, check if we have a refresh token and use it
    // if we were redirected from spotify, use the code and code verifier to get a token
    if (refreshToken || (codeVerifier && code)) {
      const newToken =
        codeVerifier && code
          ? await authWithCode(code, codeVerifier)
          : await authSpotifyWithRefreshToken(refreshToken);
      if (newToken) {
        this.spotifyToken = newToken;
        spotify.setAccessToken(newToken);
        player.setToken(newToken);

        // clear out the code verifier
        localStorage.removeItem("codeVerifier");

        setTimeout(() => {
          this.authenticate().catch(console.error);
        }, 3500 * 1000);

        // detect if the user is premium
        await spotify.users.getMe().then((user) => {
          if (user.product === "premium") this.isPremium = true;
          return null;
        });

        return;
      }
    }

    // otherwise, we need to get permissions from the user
    await grantSpotifyPermissions();
  }

  public async getAlbums(
    artistId: string
  ): Promise<GenericAlbum[] | undefined> {
    if (!this.spotifyToken) await this.authenticate();
    if (!this.spotifyToken) return;
    const combinedAlbums: SimplifiedAlbum[] = [];
    let next = true;
    let page = 0;
    while (next) {
      const albums = await spotify.artists.getArtistAlbums(artistId, {
        limit: 50,
        offset: page * 50,
        include_groups: ["album", "single"],
      });
      combinedAlbums.push(...albums.items);
      next = !!albums.next;
      page++;
    }

    return combinedAlbums.map((album) => ({
      ...album,
      image: album.images[0]?.url,
      available_markets: album.available_markets,
    }));
  }

  public async getSongs(
    albums: GenericAlbum[]
  ): Promise<GenericTrack[] | undefined> {
    if (!this.spotifyToken) await this.authenticate();
    if (!this.spotifyToken) return;
    const songPromises = albums.flatMap((album) => {
      const currentMarket = window.navigator.language.split("-")[1] ?? "US";
      const validMarket = album.available_markets?.includes(currentMarket);
      return validMarket
        ? spotify.albums.getAlbumTracks(album.id).then((tracks) =>
            tracks.items.map((track) => ({
              ...track,
              album,
            }))
          )
        : undefined;
    });

    const allSongs = await Promise.all(songPromises);
    return allSongs.flatMap((x) => x ?? []);
  }

  public async playSong(song: GenericTrack) {
    if (!this.spotifyToken) await this.authenticate();
    if (!this.spotifyToken) return;
    if (this.isPremium) {
      // hate this plugin ngl. it's not very good
      // eslint-disable-next-line scanjs-rules/call_connect
      if (!player.ready) await player.connect(this.spotifyToken);
      await player.play(song.uri);
    } else {
      fallbackAudio.src = song.preview_url || "";
      fallbackAudio.volume = 0;
      await fallbackAudio.play();
      await sleep(100);

      // fade in the audio
      const fadeTime = 1000;
      const steps = 100;
      const fade = setInterval(() => {
        fallbackAudio.volume = Math.min(1, fallbackAudio.volume + 1 / steps);
      }, fadeTime / steps);
      setTimeout(() => clearInterval(fade), fadeTime);
    }

    this.dispatchStateChange({ paused: false, currentSong: song });
  }

  public async pause() {
    if (!this.spotifyToken) await this.authenticate();
    if (!this.spotifyToken) return;
    if (this.isPremium) {
      if (player.playing) await player.pause();
    } else {
      fallbackAudio.pause();
    }
    this.dispatchStateChange({ paused: true });
  }

  public async seek(seconds: number) {
    if (!this.spotifyToken) await this.authenticate();
    if (!this.spotifyToken) return;
    if (this.isPremium) {
      await player.seek(seconds * 1000);
    } else {
      fallbackAudio.currentTime = seconds;
    }
  }

  public onStateChange(callback: (state: MusicState) => void) {
    this.stateCallbacks.push(callback);
  }

  public offStateChange(callback: (state: MusicState) => void) {
    this.stateCallbacks = this.stateCallbacks.filter((cb) => cb !== callback);
  }

  private dispatchStateChange(state: MusicState) {
    this.stateCallbacks.forEach((cb) => cb(state));
  }
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface MusicState {
  paused: boolean;
  currentSong?: GenericTrack;
}

export const useMusicProgress = () => {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    player.addListener("state", (state) => {
      if (!state) return;
      setProgress(Math.round(state.position / 1000));
      setDuration(Math.round(state.duration / 1000));
      setIsPlaying(!state.paused);
    });
  }, []);

  useEffect(() => {
    // if the music is playing, update the progress every second
    if (isPlaying) {
      const interval = setInterval(() => {
        setProgress((p) => p + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isPlaying]);

  return { progress, duration };
};
