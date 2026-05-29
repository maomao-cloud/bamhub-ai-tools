function defaultWhich() {
  return null;
}

function getPlatformBrowserCommands(platform) {
  if (platform === 'darwin') {
    return ['open'];
  }
  if (platform === 'linux') {
    return ['xdg-open'];
  }
  if (platform === 'win32') {
    return ['start'];
  }
  return [];
}

function findBrowserCommand(platform, which) {
  for (const command of getPlatformBrowserCommands(platform)) {
    const resolvedCommand = which(command);
    if (resolvedCommand) {
      return resolvedCommand;
    }
  }
  return null;
}

function hasGuiForPlatform(env, platform, browserCommand) {
  if (platform === 'darwin') {
    return Boolean(env.DISPLAY || browserCommand);
  }
  if (platform === 'linux') {
    return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  }
  if (platform === 'win32') {
    return Boolean(env.SESSIONNAME);
  }
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

export function detectLoginCapabilities({ env = {}, platform = process.platform, which = defaultWhich } = {}) {
  const safeWhich = typeof which === 'function' ? which : defaultWhich;
  const browser = findBrowserCommand(platform, safeWhich);
  const hasGui = hasGuiForPlatform(env, platform, browser);

  return {
    hasGui,
    canLaunchBrowser: Boolean(hasGui && browser),
    canImportSession: true,
    browserCommand: browser
  };
}
