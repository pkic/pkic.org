// @vitest-environment jsdom
/**
 * How a portal column description becomes a design-system column.
 *
 * The portal writes `{ header, cell, className, sort }`; the design system
 * reads `{ id, header, cell, align, width, headerHidden }`. Two of those
 * translations are conventions the portal had been repeating by hand at every
 * list, and both were wrong in the same way — they said something about how a
 * cell should look when what they meant was something about the column:
 *
 *   - Nineteen lists ended in a column with an empty `header`. Every one of
 *     them was the row's actions, and every one rendered a `<th>` containing
 *     nothing, so a screen reader announced "Revoke administrator role" under
 *     a column with no name.
 *   - Thirty-one columns wrote `pk-nowrap` on their cells. That keeps a date
 *     on one line but still lets the column claim a proportional share of a
 *     wide screen's leftover width, which is how a date ended up floating in
 *     the middle of a 2000px row.
 *
 * These assert the translation, so no list has to remember either convention.
 */

import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { DataTable, type Column } from "../../assets/ts/components/Table";

interface Member {
  id: string;
  name: string;
  joined: string;
}

const rows: Member[] = [
  { id: "mh", name: "Marit Halvorsen", joined: "2024-02-11" },
  { id: "jo", name: "Jelani Okonkwo", joined: "2025-06-30" },
];

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

function table(columns: Column<Member>[]): HTMLElement {
  return mount(<DataTable caption="Members" columns={columns} data={rows} rowKey={(row) => row.id} />);
}

const nameColumn: Column<Member> = { header: "Name", cell: (row) => row.name };

describe("the portal's column translation", () => {
  describe("a column with no header", () => {
    const actions: Column<Member>[] = [nameColumn, { header: "", cell: () => <button type="button">Remove</button> }];

    it("is named for assistive technology, with the label hidden on screen", () => {
      const container = table(actions);
      const last = [...container.querySelectorAll("th")].at(-1);
      expect(last?.textContent).toBe("Actions");
      expect(last?.querySelector(".pk-table__sr")).not.toBeNull();
    });

    it("ends the row", () => {
      const container = table(actions);
      expect([...container.querySelectorAll("th")].at(-1)?.className).toContain("pk-end");
    });

    it("keeps an alignment the list asked for itself", () => {
      const container = table([nameColumn, { header: "", className: "pk-center", cell: () => null }]);
      const last = [...container.querySelectorAll("th")].at(-1);
      expect(last?.className).toContain("pk-center");
      expect(last?.className).not.toContain("pk-end");
    });

    it("leaves a column that HAS a header alone", () => {
      const container = table([nameColumn]);
      const only = container.querySelector("th");
      expect(only?.textContent).toBe("Name");
      expect(only?.querySelector(".pk-table__sr")).toBeNull();
    });
  });

  describe("a column that asked its cells not to wrap", () => {
    it("becomes a column that hugs its content instead", () => {
      const container = table([nameColumn, { header: "Joined", className: "pk-nowrap", cell: (row) => row.joined }]);
      const joined = [...container.querySelectorAll("th")].at(-1);
      expect(joined?.className).toContain("pk-table__col--fit");
      // The utility is gone: the width class already carries the `nowrap`, and
      // two names for one decision is how the two drift apart.
      expect(container.querySelector("tbody td:nth-child(2)")?.className).not.toContain("pk-nowrap");
    });

    it("reads Bootstrap's spelling too, until the last list is converted", () => {
      const container = table([nameColumn, { header: "Joined", className: "text-nowrap", cell: (row) => row.joined }]);
      expect([...container.querySelectorAll("th")].at(-1)?.className).toContain("pk-table__col--fit");
    });

    it("defers to a width the column states outright", () => {
      const container = table([nameColumn, { header: "Joined", width: "content", cell: (row) => row.joined }]);
      expect([...container.querySelectorAll("th")].at(-1)?.className ?? "").not.toContain("pk-table__col--fit");
    });
  });

  it("still passes the utilities that describe the content rather than the column", () => {
    const container = table([{ header: "Reference", className: "pk-mono pk-small", cell: (row) => row.id }]);
    const cell = container.querySelector("tbody td");
    expect(cell?.className).toContain("pk-mono");
    expect(cell?.className).toContain("pk-small");
  });
});
