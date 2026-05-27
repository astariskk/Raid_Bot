export const PING_RESPONSES = [
    'what are you pinging me for :sob: ???',
    '⍜⎍⋏☊⟒ ⏁⊑ auegh eur aeurg ⏁ ⍜⋏ ⏁⊑⟟⌇ bogos binted ⍜⎐⟒⍀⌰⍜⍀⎅ ⍙⟟⌰⌰ ⌇ :alien: :v:',
    'hmm?',
    ':bangbang:',
    'This raid will now close. ~~not~~',

    `minesweeper: :zero::one::two::three::bomb:

|| :one: || || :two: || || :bomb: || || :one: || || :zero: ||
|| :bomb: || || :three: || || :two: || || :two: || || :zero: ||
|| :two: || || :three: || || :bomb: || || :one: || || :zero: ||
|| :one: || || :bomb: || || :two: || || :one: || || :zero: ||
|| :one: || || :one: || || :one: || || :zero: || || :zero: ||`
];

export function getRandomPingResponse() {
    const index = Math.floor(Math.random() * PING_RESPONSES.length);
    return PING_RESPONSES[index];
}