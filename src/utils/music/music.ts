import { SpotifyWebApi } from "spotify-web-api-ts";
import {
  authWithCode,
  authSpotifyWithRefreshToken,
  grantSpotifyPermissions,
} from "./spotifyAuth";
import SpotifyPlayer from "spotify-web-playback";
import { DetailedTrack } from "utils/music/types";

const spotify = new SpotifyWebApi();
const player = new SpotifyPlayer("Song Sorter");
const fallbackAudio = new Audio();

export default class Music {
  private spotifyToken?: string;
  private isPremium: boolean = false;
  spotify = spotify;

  async authenticate() {
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

        // clear out the code verifier
        localStorage.removeItem("codeVerifier");

        setTimeout(() => {
          this.authenticate();
        }, 3500 * 1000);

        // detect if the user is premium
        await spotify.users
          .getMe()
          .then((user) => {
            if (user.product === "premium") this.isPremium = true;
          })
          .catch(() => {});

        return;
      }
    }

    // otherwise, we need to get permissions from the user
    grantSpotifyPermissions();
  }

  getAlbums(artistId: string) {}

  getSongs(artistId: string) {}

  async playSong(song: DetailedTrack) {
    if (!this.spotifyToken) await this.authenticate();
    if (!this.spotifyToken) return;
    if (!this.isPremium) {
      fallbackAudio.src = song.info.preview_url || "";
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
    } else {
      if (!player.ready) await player.connect(this.spotifyToken);
      await player.play(song.info.uri);
    }

    this.dispatchStateChange({ paused: false, currentSong: song });
  }

  async pause() {
    if (!this.spotifyToken) await this.authenticate();
    if (!this.spotifyToken) return;
    if (!this.isPremium) {
      await fallbackAudio.pause();
    } else {
      await player.pause();
    }
    this.dispatchStateChange({ paused: true });
  }

  stateCallbacks: ((state: MusicState) => void)[] = [];

  onStateChange(callback: (state: MusicState) => void) {
    this.stateCallbacks.push(callback);
  }

  offStateChange(callback: (state: MusicState) => void) {
    this.stateCallbacks = this.stateCallbacks.filter((cb) => cb !== callback);
  }

  private dispatchStateChange(state: MusicState) {
    this.stateCallbacks.forEach((cb) => cb(state));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type MusicState = {
  paused: boolean;
  currentSong?: DetailedTrack;
};