// Sound-effects permission for the home page, set by SoundToggle. Starts muted on every page.
// Sound effects go through createSound() (audio files, embedded as data URIs in utils/sounds/) or getAudioContext()
// (synthesized), both of which stay silent while muted; createBackgroundSound() registers a looping track that
// follows the toggle.
// The toggle click doubles as the user gesture browsers require before a page may play audio.

const STATE: { on: boolean; context?: AudioContext } = { on: false };

type Background = {
    audio: HTMLAudioElement;
    load: () => Promise<string>;
    loading?: boolean;
    loaded?: boolean;
    gain?: GainNode;
    pause_timer?: number;
};
const BACKGROUNDS: Background[] = [];

// Tune these: background level relative to the sound effects (0-1), and fade in/out length
const BACKGROUND_VOLUME = 0.4;
const FADE_SECONDS = 0.8;

// A tenth of a second of silence, played to unlock a background track's audio element (see loadBackground)
const SILENCE =
    "data:audio/mp4;base64,AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAxJtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAKxEAAAROgABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACPXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAROgAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAEToAAAQAAAEAAAAAAbVtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAKxEAAAVOlXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAAFgbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAEkc3RibAAAAGpzdHNkAAAAAAAAAAEAAABabXA0YQAAAAAAAAABAAAAAAAAAAAAAQAQAAAAAKxEAAAAAAA2ZXNkcwAAAAADgICAJQABAASAgIAXQBUAAAAAAD6AAAAJ5AWAgIAFEghW5QAGgICAAQIAAAAgc3R0cwAAAAAAAAACAAAABQAABAAAAAABAAABOgAAABxzdHNjAAAAAAAAAAEAAAABAAAABgAAAAEAAAAsc3RzegAAAAAAAAAAAAAABgAAABMAAAAEAAAABAAAAAQAAAAEAAAABAAAABRzdGNvAAAAAAAAAAEAAAM+AAAAGnNncGQBAAAAcm9sbAAAAAIAAAAB//8AAAAcc2JncAAAAAByb2xsAAAAAQAAAAYAAAABAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMgAAAAhmcmVlAAAAL21kYXTcAExhdmM2My4xLjEwMgACMEAOARggBwEYIAcBGCAHARggBwEYIAc=";

export function isSoundOn(): boolean {
    return STATE.on;
}

export function setSoundOn(on: boolean): void {
    STATE.on = on;
    if (on) {
        STATE.context ??= new AudioContext();
        // Safari starts contexts suspended until resumed inside a gesture
        void STATE.context.resume();
    }
    for (const background of BACKGROUNDS) fadeBackground(background, on);
}

// undefined while muted, so a sound effect can just do: `const audio = getAudioContext(); if (!audio) return;`
export function getAudioContext(): AudioContext | undefined {
    return STATE.on ? STATE.context : undefined;
}

// An audio file that starts downloading now and plays from the start on play(), but only while sound is on.
// Call play() from a click handler so browsers count it as user-initiated.
export function createSound(src: string): { play: () => void } {
    const audio = new Audio(src);
    audio.preload = "auto";

    return {
        play: (): void => {
            if (!STATE.on) return;
            audio.currentTime = 0;
            // A rejected play() (e.g. the file failed to load) shouldn't surface as an error
            audio.play().catch(() => undefined);
        },
    };
}

// A looping track that fades in whenever sound is turned on and fades out (pausing, so it resumes from the same
// spot) when it's turned off. These tracks are large, so `load` fetches the track's source (e.g. a data URI from a
// JSON file) and is only called once sound is first turned on: visitors who never turn it on never download it.
export function createBackgroundSound(load: () => Promise<string>): void {
    const audio = new Audio();
    audio.loop = true;

    const background: Background = { audio, load };
    BACKGROUNDS.push(background);
    if (STATE.on) fadeBackground(background, true);
}

// Fades go through a Web Audio gain node, not audio.volume, because iOS ignores audio.volume
function fadeBackground(background: Background, on: boolean): void {
    const context = STATE.context;
    if (!context) return;
    // The first turn-on starts the download; the track fades in once it's arrived
    if (on && !background.loaded) return loadBackground(background);

    if (!background.gain) {
        background.gain = context.createGain();
        background.gain.gain.value = 0;
        context.createMediaElementSource(background.audio).connect(background.gain).connect(context.destination);
    }

    const { gain } = background.gain;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(on ? BACKGROUND_VOLUME : 0, now + FADE_SECONDS);

    window.clearTimeout(background.pause_timer);
    if (on) {
        background.audio.play().catch(() => undefined);
    } else {
        background.pause_timer = window.setTimeout(() => background.audio.pause(), FADE_SECONDS * 1000);
    }
}

// The track's module arrives after the click that turned sound on has ended, and iOS only lets an audio element
// start playing inside a click. So the element first plays a moment of silence during the click, which unlocks it
// for the real track later.
function loadBackground(background: Background): void {
    if (background.loading) return;
    background.loading = true;

    background.audio.src = SILENCE;
    background.audio.play().catch(() => undefined);

    background
        .load()
        .then((src) => {
            background.audio.src = src;
            background.loaded = true;
            // Sound may have been turned off, the tab hidden or the page left while it downloaded
            if (STATE.on && !document.hidden && BACKGROUNDS.includes(background)) fadeBackground(background, true);
        })
        // Lets the next turn-on try again
        .catch(() => (background.loading = false));
}

// The ClientRouter keeps this module between pages, but sound stays on the page that turned it on: leaving it mutes
// everything and drops that page's background tracks, which the next page registers afresh if it has any
document.addEventListener("astro:before-swap", () => {
    STATE.on = false;
    for (const background of BACKGROUNDS.splice(0)) {
        window.clearTimeout(background.pause_timer);
        background.audio.pause();
        background.gain?.disconnect();
    }
});

// Background music pauses while the tab is hidden and picks back up when it's shown again, if sound is still on
document.addEventListener("visibilitychange", () => {
    if (!STATE.on) return;
    for (const background of BACKGROUNDS) fadeBackground(background, !document.hidden);
});
