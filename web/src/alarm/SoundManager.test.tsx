/**
 * The sound manager's UI. What matters: every tone can be picked and
 * previewed, each channel keeps its own choice, and muting is never silent
 * about itself.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SoundManager, AlarmBar } from "./SoundManager";
import { alarmEngine, DEFAULT_SETTINGS } from "./soundEngine";
import { TONES } from "./tones";

beforeEach(() => {
  localStorage.clear();
  // The engine is a module-level singleton, so state set by one test survives
  // into the next unless it is reset in full — not just unmuted.
  alarmEngine.acknowledgeAll();
  alarmEngine.update(structuredClone(DEFAULT_SETTINGS));
});

afterEach(() => {
  alarmEngine.acknowledgeAll();
});

function open() {
  const onClose = vi.fn();
  render(<SoundManager open onClose={onClose} />);
  return { onClose };
}

describe("the tone library", () => {
  test("offers every tone, with its name and description", () => {
    open();
    for (const tone of TONES) {
      expect(screen.getByText(tone.name)).toBeInTheDocument();
      expect(screen.getByText(tone.description)).toBeInTheDocument();
    }
  });

  test("every tone has its own preview button", () => {
    open();
    for (const tone of TONES) {
      expect(screen.getByRole("button", { name: `Preview ${tone.name}` })).toBeInTheDocument();
    }
  });

  test("previewing a tone plays it without changing the selection", async () => {
    const preview = vi.spyOn(alarmEngine, "preview").mockResolvedValue();
    open();
    await userEvent.click(screen.getByRole("button", { name: "Preview Temple Bell" }));
    expect(preview).toHaveBeenCalledWith("temple-bell", expect.any(Number));
    // The QR channel's default is the doorbell; previewing must not reassign it.
    expect(alarmEngine.getSettings().channels.qr.tone).toBe("doorbell");
  });

  test("choosing a tone selects it and previews it immediately", async () => {
    const preview = vi.spyOn(alarmEngine, "preview").mockResolvedValue();
    open();
    await userEvent.click(screen.getByText("Marimba"));
    expect(alarmEngine.getSettings().channels.qr.tone).toBe("marimba");
    expect(preview).toHaveBeenCalledWith("marimba", expect.any(Number));
  });
});

describe("per-channel settings", () => {
  test("offers the three channels and explains each one", async () => {
    open();
    expect(screen.getByRole("tab", { name: /qr table orders/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /website orders/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /kitchen/i })).toBeInTheDocument();
    expect(screen.getByText(/a guest at a table scanned the code/i)).toBeInTheDocument();
  });

  test("each channel keeps its own tone, so staff can tell them apart by ear", async () => {
    vi.spyOn(alarmEngine, "preview").mockResolvedValue();
    open();

    await userEvent.click(screen.getByText("Temple Bell"));
    await userEvent.click(screen.getByRole("tab", { name: /website orders/i }));
    await userEvent.click(screen.getByText("Classic Beep"));

    const settings = alarmEngine.getSettings();
    expect(settings.channels.qr.tone).toBe("temple-bell");
    expect(settings.channels.website.tone).toBe("classic-beep");
    expect(settings.channels.kitchen.tone).toBe("kitchen-bell"); // untouched default
  });

  test("states the promise the screen exists for", () => {
    open();
    expect(screen.getByText(/know what arrived without looking/i)).toBeInTheDocument();
  });

  test("volume is per channel and shown as a percentage", async () => {
    open();
    expect(screen.getByText("80%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /kitchen/i }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

describe("repeat until acknowledged", () => {
  test("is on by default and offers an interval and a give-up time", () => {
    open();
    const toggle = screen.getByRole("checkbox", { name: /keep ringing until someone taps it/i });
    expect(toggle).toBeChecked();
    expect(screen.getByLabelText(/repeat every/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/give up after/i)).toBeInTheDocument();
  });

  test("turning it off hides the interval controls", async () => {
    open();
    await userEvent.click(screen.getByRole("checkbox", { name: /keep ringing/i }));
    expect(screen.queryByLabelText(/repeat every/i)).toBeNull();
    expect(alarmEngine.getSettings().repeat.enabled).toBe(false);
  });

  test("the interval can be changed", async () => {
    open();
    await userEvent.selectOptions(screen.getByLabelText(/repeat every/i), "30");
    expect(alarmEngine.getSettings().repeat.intervalSeconds).toBe(30);
  });
});

describe("mute", () => {
  test("muting is never silent about itself", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: /mute all/i }));
    expect(alarmEngine.getSettings().muted).toBe(true);
    expect(screen.getByText(/all order sounds are muted on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/new orders will arrive silently/i)).toBeInTheDocument();
  });

  test("unmuting restores the normal state", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: /mute all/i }));
    await userEvent.click(screen.getByRole("button", { name: /unmute/i }));
    expect(alarmEngine.getSettings().muted).toBe(false);
  });
});

describe("first run and testing", () => {
  test("offers a one-time tap to enable audio, because browsers block it", () => {
    open();
    expect(screen.getByText(/tap to enable order sounds/i)).toBeInTheDocument();
    expect(screen.getByText(/stay silent until someone touches the screen/i)).toBeInTheDocument();
  });

  test("a manager can test every channel before service", async () => {
    const testAll = vi.spyOn(alarmEngine, "testAll").mockResolvedValue();
    open();
    await userEvent.click(screen.getByRole("button", { name: /test all sounds/i }));
    expect(testAll).toHaveBeenCalled();
  });

  test("says the settings are per device", () => {
    open();
    expect(screen.getByText(/apply to this device only/i)).toBeInTheDocument();
  });
});

describe("the ringing bar", () => {
  test("is absent when nothing is ringing", () => {
    const { container } = render(<AlarmBar />);
    expect(container).toBeEmptyDOMElement();
  });

  test("appears while an alarm is unacknowledged and silences it when tapped", async () => {
    alarmEngine.ring("qr");
    render(<AlarmBar />);
    const bar = await screen.findByRole("button", { name: /tap to silence/i });
    expect(within(bar).getByText(/qr table orders — waiting/i)).toBeInTheDocument();

    await userEvent.click(bar);
    expect(alarmEngine.getPending()).toEqual([]);
  });

  test("collapses to a count when several are ringing at once", async () => {
    alarmEngine.ring("qr");
    alarmEngine.ring("website");
    render(<AlarmBar />);
    expect(await screen.findByText(/2 alerts waiting/i)).toBeInTheDocument();
  });
});
