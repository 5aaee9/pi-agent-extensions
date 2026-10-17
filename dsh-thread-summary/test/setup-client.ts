import React from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { vi } from "vitest";

// Unit tests cover our state transitions. Browser verification uses the actual
// shell primitives, including their CSS, portals and keyboard/focus behavior.
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) =>
    React.createElement("button", props),
  Switch: ({
    checked,
    onChange,
    label,
    disabled,
  }: {
    checked: boolean;
    onChange: (value: boolean) => void;
    label: string;
    disabled?: boolean;
  }) =>
    React.createElement("button", {
      role: "switch",
      "aria-label": label,
      "aria-checked": checked,
      disabled,
      onClick: () => onChange(!checked),
    }),
  Menu: ({
    open,
    anchor,
    items,
    onSelect,
  }: {
    open: boolean;
    anchor: ReactNode;
    items: readonly { id: string; label: ReactNode }[];
    onSelect: (value: string) => void;
  }) =>
    React.createElement(
      React.Fragment,
      null,
      anchor,
      open &&
        React.createElement(
          "div",
          { role: "menu" },
          items.map((item) =>
            React.createElement(
              "button",
              {
                key: item.id,
                role: "menuitem",
                "data-value": item.id,
                onClick: () => onSelect(item.id),
              },
              item.label,
            ),
          ),
        ),
    ),
}));
