import { toast } from "./ui";

export async function performAdminAction<Result>({
  setBusy,
  request,
  successMessage,
  afterSuccess,
  onError,
}: {
  setBusy?: (busy: boolean) => void;
  request: () => Promise<Result>;
  successMessage?: string;
  afterSuccess?: (result: Result) => void | Promise<void>;
  onError?: (message: string) => void;
}): Promise<boolean> {
  setBusy?.(true);
  try {
    const result = await request();
    if (successMessage) toast(successMessage, "success");
    await afterSuccess?.(result);
    return true;
  } catch (error) {
    const message = (error as Error).message;
    onError?.(message);
    toast(message, "error");
    return false;
  } finally {
    setBusy?.(false);
  }
}

export async function saveAdminEditor<Result>({
  setSaving,
  setStatus,
  request,
  successMessage,
  successStatus = () => "✓ Saved",
  reload,
}: {
  setSaving: (saving: boolean) => void;
  setStatus: (status: string) => void;
  request: () => Promise<Result>;
  successMessage: string;
  successStatus?: (result: Result) => string;
  reload: () => Promise<void>;
}): Promise<boolean> {
  setStatus("Saving…");
  return performAdminAction({
    setBusy: setSaving,
    request,
    successMessage,
    afterSuccess: async (result) => {
      setStatus(successStatus(result));
      await reload();
    },
    onError: setStatus,
  });
}
