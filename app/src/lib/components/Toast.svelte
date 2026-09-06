<script lang="ts">
  let {
    message,
    kind = "ok",
    duration = 2200,
    onexpire,
  }: {
    message: string;
    kind?: "ok" | "err";
    /** Auto-dismiss delay in ms; null keeps the toast visible until it is
     *  replaced or the host clears it. */
    duration?: number | null;
    onexpire?: () => void;
  } = $props();

  $effect(() => {
    if (duration == null) return;
    const t = setTimeout(() => onexpire?.(), duration);
    return () => clearTimeout(t);
  });
</script>

<div class="toast toast-{kind}" role="status">{message}</div>

<style>
  .toast {
    position: fixed;
    top: 54px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    color: #ffffff;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
    animation: slideUpCentered 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .toast-ok {
    background: #10b981;
  }

  .toast-err {
    background: #ef4444;
  }

  @keyframes slideUpCentered {
    from {
      opacity: 0;
      transform: translate(-50%, 14px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
