import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { clearRecords } from "../../entities/session/api";

export function ClearHistoryButton() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: clearRecords,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      navigate("/", { replace: true });
    },
  });

  return (
    <button
      id="clear-btn"
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? "清除中" : "清除"}
    </button>
  );
}
