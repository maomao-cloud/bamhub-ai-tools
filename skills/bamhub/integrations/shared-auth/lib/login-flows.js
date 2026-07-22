const CAPABILITY_UNAVAILABLE_ERROR = 'AUTH_CAPABILITY_UNAVAILABLE';

function requireGui(capabilities) {
  if (!capabilities.canLaunchBrowser) {
    throw new Error(CAPABILITY_UNAVAILABLE_ERROR);
  }
  return 'gui';
}

function requireHeadless(capabilities) {
  if (!capabilities.canImportSession) {
    throw new Error(CAPABILITY_UNAVAILABLE_ERROR);
  }
  return 'headless';
}

export function chooseLoginMode(profile = {}, capabilities = {}, explicitMode) {
  const requestedMode = explicitMode || profile.loginMode || 'auto';

  if (requestedMode === 'import') {
    return 'import';
  }
  if (requestedMode === 'gui') {
    return requireGui(capabilities);
  }
  if (requestedMode === 'headless') {
    return requireHeadless(capabilities);
  }
  if (requestedMode === 'auto') {
    if (capabilities.canLaunchBrowser) {
      return 'gui';
    }
    if (capabilities.canImportSession) {
      return 'headless';
    }
  }
  throw new Error(CAPABILITY_UNAVAILABLE_ERROR);
}
