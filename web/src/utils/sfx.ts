// Sound-effects permission for the home page, set by SoundToggle. Starts muted on every load.
// Any future sound effect should go through getAudioContext(), which only hands back a context while sound is on.
// The toggle click doubles as the user gesture browsers require before a page may play audio.

const STATE: { on: boolean; context?: AudioContext } = { on: false };

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
}

// undefined while muted, so a sound effect can just do: `const audio = getAudioContext(); if (!audio) return;`
export function getAudioContext(): AudioContext | undefined {
    return STATE.on ? STATE.context : undefined;
}
