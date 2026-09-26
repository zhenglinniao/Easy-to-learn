import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { ModalFocusBoundary } from './ModalFocusBoundary';

function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      {open ? (
        <ModalFocusBoundary ariaLabelledby="modal-title" onDismiss={() => setOpen(false)}>
          <h2 id="modal-title">确认操作</h2>
          <button type="button">取消</button>
          <button type="button">确认</button>
        </ModalFocusBoundary>
      ) : null}
    </>
  );
}

describe('ModalFocusBoundary', () => {
  it('moves focus inside, traps tab navigation, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: '打开' });

    await user.click(trigger);
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确认' });
    expect(cancel).toHaveFocus();

    confirm.focus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
