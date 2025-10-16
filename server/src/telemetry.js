import { PostHog } from 'posthog-node';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const POSTHOG_KEY = process.env.POSTHOG_KEY || '<your_project_api_key>';
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

// Create install ID file for consistent user identification
// Use the same app data directory structure as the rest of the extension
function platformAppData(appName) {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', appName);
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', appName);
  return path.join(home, '.config', appName);
}

const BASE_DIR = process.env.SYNC_EXTENSIONS_DIR || platformAppData('sync. extensions');
const idFile = path.join(BASE_DIR, '.install-id');
fs.mkdirSync(path.dirname(idFile), { recursive: true });

let distinctId;
try {
  distinctId = fs.readFileSync(idFile, 'utf8');
} catch {
  distinctId = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(idFile, distinctId, 'utf8');
}

// Export distinctId for use in other modules
export { distinctId };

// Initialize PostHog client
export const ph = new PostHog(POSTHOG_KEY, { 
  host: POSTHOG_HOST,
  flushAt: 1, // Send events immediately for testing
  flushInterval: 1000, // Send events every 1 second for testing
  debug: true // Enable debug mode
});

// Track function with error handling
export async function track(event, properties = {}) {
  try {
    const eventData = {
      distinctId,
      event,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version
      }
    };

    // Use captureImmediate for critical events to ensure they're sent
    await ph.captureImmediate(eventData);

    // Debug logging (only in development)
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_POSTHOG) {
      console.log('PostHog event captured:', event, eventData.properties);
    }
  } catch (error) {
    console.error('PostHog tracking error:', error.message);
  }
}

// Identify user with additional properties
export function identify(properties = {}) {
  try {
    ph.identify({
      distinctId,
      properties: {
        ...properties,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        extensionVersion: process.env.EXTENSION_VERSION || 'unknown'
      }
    });
  } catch (error) {
    console.error('PostHog identify error:', error.message);
  }
}

// Set user properties
export function setUserProperties(properties = {}) {
  try {
    ph.setPersonProperties({
      distinctId,
      properties
    });
  } catch (error) {
    console.error('PostHog setUserProperties error:', error.message);
  }
}

// Shutdown PostHog on process exit
process.on('beforeExit', () => {
  try {
    ph.shutdown();
  } catch (error) {
    console.error('PostHog shutdown error:', error.message);
  }
});

// Graceful shutdown on SIGTERM/SIGINT
process.on('SIGTERM', () => {
  try {
    ph.shutdown();
  } catch (error) {
    console.error('PostHog SIGTERM shutdown error:', error.message);
  }
});

process.on('SIGINT', () => {
  try {
    ph.shutdown();
  } catch (error) {
    console.error('PostHog SIGINT shutdown error:', error.message);
  }
});
