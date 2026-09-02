/**
 * Context Menu Unit & Integration Test Suite
 * Tests global context menu state store, queue insertion, and submenus.
 */

export async function runContextMenuTests(jiti: any) {
  console.log("\n=======================================================");
  console.log("  CONTEXT MENU & PLAYLIST SUBMENU VERIFICATION");
  console.log("=======================================================\n");

  let totalAssertions = 0;
  let passedAssertions = 0;

  function assert(condition: boolean, description: string) {
    totalAssertions++;
    if (!condition) {
      console.error(`  ❌ FAILED: ${description}`);
      throw new Error(`Assertion failed: ${description}`);
    }
    passedAssertions++;
  }

  const { useContextMenuStore } = jiti("../src/stores/contextMenuStore.ts");
  const { usePlayerStore } = jiti("../src/stores/playerStore.ts");

  // 1. Test contextMenuStore open, close, and position
  console.log("--- 1. Testing Context Menu Store Lifecycle ---");
  const initial = useContextMenuStore.getState();
  assert(initial.isOpen === false, "Context menu is initially closed");
  assert(initial.items.length === 0, "Context menu has 0 initial items");

  let clickedItemA = false;
  let clickedItemB = false;

  let prevented = false;
  let stopped = false;
  const mockEvent = {
    clientX: 250,
    clientY: 350,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
  };

  const testItems = [
    {
      id: "item-a",
      label: "Play Track",
      onClick: () => { clickedItemA = true; },
    },
    {
      id: "divider-1",
      label: "",
      divider: true,
    },
    {
      id: "item-b",
      label: "Add to Playlist",
      items: [
        {
          id: "sub-1",
          label: "Playlist Alpha",
          onClick: () => { clickedItemB = true; },
        },
      ],
    },
  ];

  useContextMenuStore.getState().openContextMenu(mockEvent as any, testItems);
  const openState = useContextMenuStore.getState();
  assert(openState.isOpen === true, "openContextMenu set isOpen to true");
  assert(openState.position.x === 250 && openState.position.y === 350, "Coordinates recorded accurately");
  assert(openState.items.length === 3, "All menu items loaded into store");
  assert(prevented === true, "preventDefault called on context menu trigger");
  assert(stopped === true, "stopPropagation called on context menu trigger");

  // Execute item A
  openState.items[0].onClick?.();
  assert(clickedItemA === true, "Item A onClick callback fired properly");

  // Execute submenu item
  assert(openState.items[2].items?.length === 1, "Submenu has 1 item");
  openState.items[2].items?.[0].onClick?.();
  assert(clickedItemB === true, "Submenu item onClick callback fired properly");

  // Close context menu
  useContextMenuStore.getState().closeContextMenu();
  const closedState = useContextMenuStore.getState();
  assert(closedState.isOpen === false, "closeContextMenu reset isOpen to false");
  assert(closedState.items.length === 0, "closeContextMenu emptied items");

  // 2. Test PlayerStore insertAfterCurrent queue operation
  console.log("\n--- 2. Testing insertAfterCurrent Queue Operations ---");
  const track1 = { id: "t1", path: "/music/1.mp3", metadata: { title: "Track 1", artist: "Artist A", album: "Album X", duration: { secs: 180, nanos: 0 }, format: "mp3" } };
  const track2 = { id: "t2", path: "/music/2.mp3", metadata: { title: "Track 2", artist: "Artist A", album: "Album X", duration: { secs: 200, nanos: 0 }, format: "mp3" } };
  const track3 = { id: "t3", path: "/music/3.mp3", metadata: { title: "Track 3", artist: "Artist A", album: "Album X", duration: { secs: 220, nanos: 0 }, format: "mp3" } };
  const trackNext = { id: "t-next", path: "/music/next.mp3", metadata: { title: "Play Next Track", artist: "Artist B", album: "Album Y", duration: { secs: 150, nanos: 0 }, format: "flac" } };

  usePlayerStore.getState().clearQueue();
  await usePlayerStore.getState().setQueue([track1, track2, track3], 0);

  let qState = usePlayerStore.getState();
  assert(qState.queue.length === 3, "Queue initialized with 3 tracks");
  assert(qState.queueIndex === 0, "Active track is index 0");
  assert(qState.currentTrackId === "t1", "Current track is t1");

  // Call insertAfterCurrent (Play Next)
  usePlayerStore.getState().insertAfterCurrent(trackNext as any);
  qState = usePlayerStore.getState();

  assert(qState.queue.length === 4, "Queue length increased to 4");
  assert(qState.queue[1].id === "t-next", "trackNext inserted directly at index 1 (next up)");
  assert(qState.queue[0].id === "t1", "Current track still at index 0");
  assert(qState.queue[2].id === "t2", "Original track 2 shifted to index 2");
  assert(qState.queue[3].id === "t3", "Original track 3 shifted to index 3");

  console.log(`\n  ✓ All ${passedAssertions}/${totalAssertions} context menu & queue insertion tests passed!`);

  return {
    success: true,
    passedAssertions,
    totalAssertions,
  };
}
