// Sound-effects permission for the home page, set by SoundToggle. Starts muted on every page.
// Sound effects go through createSound() (audio files) or getAudioContext() (synthesized), both of which stay
// silent while muted; createBackgroundSound() registers a looping track that follows the toggle.
// The toggle click doubles as the user gesture browsers require before a page may play audio.

const STATE: { on: boolean; context?: AudioContext } = { on: false };

type Background = { audio: HTMLAudioElement; gain?: GainNode; pause_timer?: number };
const BACKGROUNDS: Background[] = [];

// Tune these: background level relative to the sound effects (0-1), and fade in/out length
const BACKGROUND_VOLUME = 0.4;
const FADE_SECONDS = 0.8;

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
// spot) when it's turned off. Nothing downloads until sound is first turned on, since these files tend to be large.
export function createBackgroundSound(src: string): void {
    const audio = new Audio(src);
    audio.loop = true;
    audio.preload = "none";

    const background: Background = { audio };
    BACKGROUNDS.push(background);
    if (STATE.on) fadeBackground(background, true);
}

// Fades go through a Web Audio gain node, not audio.volume, because iOS ignores audio.volume
function fadeBackground(background: Background, on: boolean): void {
    const context = STATE.context;
    if (!context) return;

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
