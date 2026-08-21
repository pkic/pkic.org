import { beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../../assets/ts/admin/ui", () => ({ toast }));

import { performAdminAction, saveAdminEditor } from "../../assets/ts/admin/actions";

describe("performAdminAction", () => {
  beforeEach(() => toast.mockReset());

  it("applies the shared busy, success, and refresh behavior", async () => {
    const busy: boolean[] = [];
    const request = vi.fn().mockResolvedValue(undefined);
    const afterSuccess = vi.fn().mockResolvedValue(undefined);

    await expect(
      performAdminAction({
        setBusy: (value) => {
          busy.push(value);
        },
        request,
        successMessage: "Saved",
        afterSuccess,
      }),
    ).resolves.toBe(true);

    expect(busy).toEqual([true, false]);
    expect(request).toHaveBeenCalledOnce();
    expect(afterSuccess).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("Saved", "success");
  });

  it("reports failures, clears busy state, and does not run success effects", async () => {
    const busy: boolean[] = [];
    const afterSuccess = vi.fn();

    await expect(
      performAdminAction({
        setBusy: (value) => {
          busy.push(value);
        },
        request: () => Promise.reject(new Error("request failed")),
        afterSuccess,
      }),
    ).resolves.toBe(false);

    expect(busy).toEqual([true, false]);
    expect(afterSuccess).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("request failed", "error");
  });

  it("uses one save lifecycle for editable settings resources", async () => {
    const saving: boolean[] = [];
    const statuses: string[] = [];
    const reload = vi.fn().mockResolvedValue(undefined);
    await expect(
      saveAdminEditor({
        setSaving: (value) => {
          saving.push(value);
        },
        setStatus: (value) => {
          statuses.push(value);
        },
        request: () => Promise.resolve({ skipped: ["day-1"] }),
        successMessage: "Updated",
        successStatus: ({ skipped }) => `Saved with ${skipped.length} warning`,
        reload,
      }),
    ).resolves.toBe(true);

    expect(saving).toEqual([true, false]);
    expect(statuses).toEqual(["Saving…", "Saved with 1 warning"]);
    expect(reload).toHaveBeenCalledOnce();
  });
});
