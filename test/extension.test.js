const assert = require("assert");

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = require("vscode");
const extensionModule = require("../extension");

function createMockContext() {
  const state = {};
  return {
    subscriptions: [],
    extensionUri: {},
    globalState: {
      get: (key, fallbackValue) =>
        Object.prototype.hasOwnProperty.call(state, key)
          ? state[key]
          : fallbackValue,
      update: async (key, value) => {
        state[key] = value;
      },
    },
  };
}

function withMockedTimers(testFn) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;

  const scheduled = [];
  let currentId = 0;
  global.setTimeout = (callback, delay, ...args) => {
    const entry = {
      id: ++currentId,
      callback: () => callback(...args),
      delay,
      cleared: false,
    };
    scheduled.push(entry);
    return entry;
  };
  global.clearTimeout = (timeoutRef) => {
    if (timeoutRef) {
      timeoutRef.cleared = true;
    }
  };

  return (async () => {
    try {
      await testFn(scheduled);
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  })();
}

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Urgent iqama flow triggers prayer lock panel", async () => {
    await withMockedTimers(async (scheduled) => {
      const provider = new extensionModule.__test.SidebarProvider(
        createMockContext(),
      );

      provider._getConfiguration = () => ({
        enablePrayerNotifications: true,
        enablePrayerReminderSystem: true,
        iqamaPrepareDelayMinutes: 1,
        iqamaUrgentDelayMinutes: 1,
        previousPrayerRepeatDelayMinutes: 10,
      });

      provider._clearPrayerTimeouts = () => {
        provider._prayerTimeouts.clear();
      };

      provider._runUniquePrayerEvent = async (_eventKey, handler) => {
        await handler();
      };

      provider._showPrayerNotification = () => {};

      let lockActivatedFor = "";
      provider._activatePrayerLock = (prayerName) => {
        lockActivatedFor = prayerName;
      };

      const targetTime = new Date(Date.now() + 2 * 60 * 1000);
      const prayerTimes = {
        Dhuhr: `${String(targetTime.getHours()).padStart(2, "0")}:${String(targetTime.getMinutes()).padStart(2, "0")}`,
      };

      provider._schedulePrayerNotifications(prayerTimes);

      // Execute callbacks in chronological order to simulate time passing.
      scheduled
        .slice()
        .sort((a, b) => a.delay - b.delay)
        .forEach((timer) => {
          if (!timer.cleared) {
            timer.callback();
          }
        });

      assert.strictEqual(lockActivatedFor, "Dhuhr");
    });
  });

  test("Repeat reminder is scheduled only for explicit 10-min choice", async () => {
    await withMockedTimers(async (scheduled) => {
      const context = createMockContext();
      const provider = new extensionModule.__test.SidebarProvider(context);

      provider._getConfiguration = () => ({
        enablePrayerNotifications: true,
        enablePrayerReminderSystem: true,
        previousPrayerRepeatDelayMinutes: 10,
      });

      const originalShowInformationMessage =
        vscode.window.showInformationMessage;
      vscode.window.showInformationMessage = async () =>
        "Not yet, remind me in 10 min";

      try {
        await provider._askPreviousPrayerCheck(
          { key: "Asr", name: "Asr" },
          new Date(),
        );
      } finally {
        vscode.window.showInformationMessage = originalShowInformationMessage;
      }

      const tenMinutesMs = 10 * 60 * 1000;
      const hasTenMinuteRetry = scheduled.some(
        (timer) => timer.delay === tenMinutesMs,
      );

      assert.strictEqual(hasTenMinuteRetry, true);
    });
  });

  test("Dismissed previous-prayer prompt does not schedule retry", async () => {
    await withMockedTimers(async (scheduled) => {
      const context = createMockContext();
      const provider = new extensionModule.__test.SidebarProvider(context);

      provider._getConfiguration = () => ({
        enablePrayerNotifications: true,
        enablePrayerReminderSystem: true,
        previousPrayerRepeatDelayMinutes: 10,
      });

      const originalShowInformationMessage =
        vscode.window.showInformationMessage;
      vscode.window.showInformationMessage = async () => undefined;

      try {
        await provider._askPreviousPrayerCheck(
          { key: "Asr", name: "Asr" },
          new Date(),
        );
      } finally {
        vscode.window.showInformationMessage = originalShowInformationMessage;
      }

      const tenMinutesMs = 10 * 60 * 1000;
      const hasTenMinuteRetry = scheduled.some(
        (timer) => timer.delay === tenMinutesMs,
      );

      assert.strictEqual(hasTenMinuteRetry, false);
    });
  });

  test("Sample test", () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});
