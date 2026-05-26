export const PING_RESPONSES = [
    'what are you pinging me for :sob: ???',
    '⍜⎍⋏☊⟒ ⏁⊑ auegh eur aeurg ⏁ ⍜⋏ ⏁⊑⟟⌇ bogos binted ⍜⎐⟒⍀⌰⍜⍀⎅ ⍙⟟⌰⌰ ⌇ :alien: :v: ',
    'hmm?',
    ':bangbang:',
    'This raid will now close. ~~not~~',
];

export function getRandomPingResponse() {
    const index = Math.floor(Math.random() * PING_RESPONSES.length);
    return PING_RESPONSES[index];
}