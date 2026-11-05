<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { listen } from "@tauri-apps/api/event";
  import { watchLang } from "$lib/i18n";

  let { children } = $props();

  onMount(() => {
    let un: (() => void) | undefined;
    let unShowHistory: (() => void) | undefined;
    let cancelled = false;
    void watchLang().then((fn) => {
      if (cancelled) fn();
      else un = fn;
    });
    void listen("show-history", () => {
      void goto("/");
    }).then((fn) => {
      if (cancelled) fn();
      else unShowHistory = fn;
    }).catch(() => {});
    return () => {
      cancelled = true;
      un?.();
      unShowHistory?.();
    };
  });
</script>

{@render children()}
