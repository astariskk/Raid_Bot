/** @typedef {'create' | 'edit'} RaidWizardMode */

export const WIZARD_MODE = Object.freeze({
  CREATE: 'create',
  EDIT: 'edit',
});

export function getWizardComponentPrefix(mode) {
  return mode === WIZARD_MODE.EDIT ? 'raidWizardEdit' : 'raidWizard';
}

export function wizardCustomId(mode, part, sessionId) {
  return `${getWizardComponentPrefix(mode)}_${part}_${sessionId}`;
}

export function getWizardPageTitle(mode) {
  return mode === WIZARD_MODE.EDIT ? 'Edit Raid' : 'Start Raid';
}

export function getWizardSessionExpiredMessage(mode) {
  return mode === WIZARD_MODE.EDIT
    ? 'This edit session expired. Press Edit Request again.'
    : 'This raid creation session expired. Press Start Raid again.';
}
