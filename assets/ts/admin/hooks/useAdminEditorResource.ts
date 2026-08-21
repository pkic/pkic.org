import { useEffect, useState } from "preact/hooks";
import { useData } from "../../hooks/useData";

/** Loads an admin detail resource and synchronizes it into editable local state. */
export function useAdminEditorResource<Value>(
  fetcher: () => Promise<Value>,
  dependencies: unknown[],
  initialValue: Value,
) {
  const resource = useData(fetcher, dependencies);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (resource.data !== null) setValue(resource.data);
  }, [resource.data]);

  return {
    value,
    setValue,
    loading: resource.loading,
    error: resource.error,
    reload: resource.reload,
  };
}
