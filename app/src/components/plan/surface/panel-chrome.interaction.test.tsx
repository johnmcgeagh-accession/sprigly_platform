/**
 * @vitest-environment jsdom
 *
 * panel-chrome.interaction.test.tsx — one inside, two frames.
 *
 * The desktop surface does not re-implement the detail sheet or the conversation; it renders the
 * SAME components with `chrome="panel"`. That only holds if the swap is genuinely a frame swap,
 * so this drives both chromes and asserts the four things that must differ and the one that
 * must not.
 *
 * THE LOAD-BEARING ONE IS THE FOCUS TRAP. `Sheet` traps focus because it is `aria-modal`. A
 * docked conversation that trapped focus would make the month beside it unreachable by
 * keyboard — the exact opposite of why it is docked — so a panel must let Tab out. That is a
 * behaviour, not a class name, and it is asserted by moving focus.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { Sheet } from './Sheet';
import { Panel } from './Panel';

afterEach(cleanup);

function body() {
  return (
    <>
      <button data-testid="inside-first">first</button>
      <button data-testid="inside-last">last</button>
    </>
  );
}

/** Render the frame with a focusable sibling OUTSIDE it, which is what a trap would exclude. */
function mount(Frame: typeof Sheet | typeof Panel, onClose = vi.fn()) {
  render(
    <div>
      <button data-testid="outside">outside</button>
      <Frame open label="What we understood" testid="frame" onClose={onClose}>
        {body()}
      </Frame>
    </div>,
  );
  return { onClose };
}

describe('the frame swap', () => {
  it('a SHEET is a modal dialog; a PANEL is a named region', () => {
    mount(Sheet);
    const sheet = screen.getByTestId('frame');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    cleanup();

    mount(Panel);
    const panel = screen.getByTestId('frame');
    expect(panel.tagName).toBe('SECTION');
    expect(panel.getAttribute('role')).toBeNull();
    expect(panel.getAttribute('aria-modal')).toBeNull();
    // Named either way — a region without one is a region a screen reader cannot announce.
    expect(panel.getAttribute('aria-label')).toBe('What we understood');
  });

  it('a SHEET dims what it covers; a PANEL has nothing to dim', () => {
    mount(Sheet);
    expect(screen.queryByTestId('frame-scrim')).not.toBeNull();
    cleanup();

    mount(Panel);
    expect(screen.queryByTestId('frame-scrim')).toBeNull();
  });

  it('a SHEET carries the grabber that closes it; a PANEL does not dismiss at all', () => {
    const { onClose } = mount(Sheet);
    const grabber = screen.getByTestId('frame-grabber');
    expect(grabber).not.toBeNull();
    // A keyboard activation — no pointer sequence in front of it — closes the sheet.
    fireEvent.click(grabber);
    expect(onClose).toHaveBeenCalled();
    cleanup();

    const panel = mount(Panel);
    expect(screen.queryByTestId('frame-grabber')).toBeNull();
    expect(panel.onClose).not.toHaveBeenCalled();
  });

  it('a SHEET intercepts Tab at its own edge; a PANEL lets focus leave — the dock depends on it', () => {
    mount(Sheet);
    const lastInSheet = screen.getByTestId('inside-last');
    lastInSheet.focus();
    fireEvent.keyDown(screen.getByTestId('frame'), { key: 'Tab' });
    /**
     * Focus was PULLED BACK to the sheet — it did not stay where Tab found it. In a browser it
     * would land on the first focusable inside; here it lands on the sheet container itself,
     * because `useFocusTrap` filters its candidates on `offsetParent !== null` and jsdom
     * computes no layout, so the list is empty and the trap takes its own zero-focusables
     * branch. Either way the assertion that matters holds: Tab did not escape.
     */
    expect(document.activeElement).toBe(screen.getByTestId('frame'));
    expect(document.activeElement).not.toBe(lastInSheet);
    cleanup();

    mount(Panel);
    const lastInPanel = screen.getByTestId('inside-last');
    lastInPanel.focus();
    fireEvent.keyDown(screen.getByTestId('frame'), { key: 'Tab' });
    // Nothing intercepted it: focus is where the browser left it, free to move on to the month.
    expect(document.activeElement).toBe(lastInPanel);
  });

  it('Escape closes a SHEET and does nothing to a PANEL', () => {
    const sheet = mount(Sheet);
    fireEvent.keyDown(screen.getByTestId('frame'), { key: 'Escape' });
    expect(sheet.onClose).toHaveBeenCalled();
    cleanup();

    const panel = mount(Panel);
    fireEvent.keyDown(screen.getByTestId('frame'), { key: 'Escape' });
    expect(panel.onClose).not.toHaveBeenCalled();
  });

  it('the INSIDE is identical — the swap is a frame, not a second component', () => {
    mount(Sheet);
    const inSheet = [screen.getByTestId('inside-first'), screen.getByTestId('inside-last')].map((e) => e.textContent);
    cleanup();

    mount(Panel);
    const inPanel = [screen.getByTestId('inside-first'), screen.getByTestId('inside-last')].map((e) => e.textContent);
    expect(inPanel).toEqual(inSheet);
  });

  it('neither renders anything when closed', () => {
    render(<Sheet open={false} label="x" testid="frame" onClose={vi.fn()}>{body()}</Sheet>);
    expect(screen.queryByTestId('frame')).toBeNull();
    cleanup();
    render(<Panel open={false} label="x" testid="frame" onClose={vi.fn()}>{body()}</Panel>);
    expect(screen.queryByTestId('frame')).toBeNull();
  });
});
