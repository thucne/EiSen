<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { FolderOpen } from "@lucide/svelte";
  import { hideFeedback, revealPath } from "$lib/api";
  import { i18n, initLang } from "$lib/i18n";

  /** A save stays longer so there is time to reach "Show in folder". */
  const DISMISS_MS = 2200;
  const DISMISS_WITH_PATH_MS = 5000;

  type Feedback = { message: string; kind: "ok" | "err"; path: string | null };

  const t = $derived($i18n);
  let feedback = $state<Feedback | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function dismiss() {
    feedback = null;
    void hideFeedback();
  }

  function pauseDismiss() {
    clearTimeout(timer);
  }

  function scheduleDismiss() {
    clearTimeout(timer);
    if (!feedback) return;
    timer = setTimeout(dismiss, feedback.path ? DISMISS_WITH_PATH_MS : DISMISS_MS);
  }

  async function reveal() {
    if (!feedback?.path) return;
    try {
      await revealPath(feedback.path);
      dismiss();
    } catch (err) {
      feedback = { message: String(err), kind: "err", path: null };
      scheduleDismiss();
    }
  }

  onMount(() => {
    void initLang();
    const un = listen<Feedback>("feedback-show", (event) => {
      feedback = event.payload;
      scheduleDismiss();
    });
    return () => {
      clearTimeout(timer);
      void un.then((fn) => fn());
    };
  });
</script>

{#if feedback}
  <div
    class="feedback feedback-{feedback.kind}"
    role="status"
    onpointerenter={pauseDismiss}
    onpointerleave={scheduleDismiss}
  >
    <span class="message">{feedback.message}</span>
    {#if feedback.path}
      <button type="button" class="reveal" onclick={reveal}>
        <FolderOpen size={14} />
        <span>{t.feedback.reveal}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  :global(html),
  :global(body) {
    background: transparent;
    overflow: hidden;
  }

  .feedback {
    position: fixed;
    inset: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 10px 0 16px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(15, 16, 21, 0.94);
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    user-select: none;
  }

  .feedback-err {
    background: #b91c1c;
  }

  .message {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reveal {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 0;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.14);
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .reveal:hover {
    background: rgba(255, 255, 255, 0.24);
  }
</style>
