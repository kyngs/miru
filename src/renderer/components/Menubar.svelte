<script>
  import { getContext } from 'svelte'
  import { click } from '@/modules/click.js'

  export let page
  const view = getContext('view')
  function close () {
    $view = null
    page = 'home'
  }
</script>

<div class='w-full z-101 navbar bg-transparent border-0 p-0 d-flex'>
  <div class='d-flex h-full draggable align-items-center text-center'>
    {#if window.version.platform !== 'darwin'}
      <img src='./logo.ico' class='position-absolute w-50 h-50 m-10 pointer' alt='ico' use:click={close} />
    {/if}
  </div>
  <div class='h-full bg-dark flex-grow-1'>
  </div>
</div>

<style>
  .z-101 {
    z-index: 101 !important
  }
  .draggable {
    -webkit-app-region: drag;
    color: var(--dm-text-muted-color);
    font-size: 11.2px;
    width: calc(env(titlebar-area-width, 100%) - 1px);
  }
  img {
    top: 0;
    -webkit-app-region: no-drag
  }
  .close {
    width: 40px;
  }
  .close:hover {
    background-color: #e81123 !important;
  }
  svg {
    width: 18px;
    height: 18px;
    width: 100%;
  }
  path {
    fill: currentColor;
  }
</style>
