<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { watchLang } from "$lib/i18n";

  let { children } = $props();

  onMount(() => {
    let un: (() => void) | undefined;
    let cancelled = false;
    void watchLang().then((fn) => {
      if (cancelled) fn();
      else un = fn;
    });
    return () => {
      cancelled = true;
      un?.();
    };
  });
</script>

{@render children()}
