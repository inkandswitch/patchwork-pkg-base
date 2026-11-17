// The arithmetic of faces in the canvas. Spots are in page space (the canvas's
// own coordinates): the top left of the face, and its diameter.
//
// This knows nothing of the call package: what a spot is, and who's in the
// call, arrive over the `patchwork:call-faces` subscription (CallFaces.tsx).

export type Spot = { x: number; y: number; size: number };
export type Person = {
  key: string;
  id: string;
  name: string;
  colour: string;
  me: boolean;
};
export type FacesState = {
  here: boolean;
  people: Person[];
  spots: Record<string, Spot>;
};

export const NO_FACES: FacesState = { here: false, people: [], spots: {} };

export const MIN_SIZE = 32;
export const MAX_SIZE = 2000;
// How big a face starts, on screen, however far in or out the view is.
export const START_PX = 96;

export const clampSize = (size: number) =>
  Math.min(MAX_SIZE, Math.max(MIN_SIZE, size));

/** The people in the call who haven't been put on this canvas. */
export function unplaced(state: FacesState): Person[] {
  return state.people.filter((person) => !state.spots[person.key]);
}

/**
 * Spots in a row, centred on `center` (a page point), `px` wide on screen at
 * `zoom`, for the people given, in order.
 */
export function rowAround(
  people: Person[],
  center: { x: number; y: number },
  zoom: number,
  px = START_PX,
): Record<string, Spot> {
  const size = px / zoom;
  const gap = size * 0.2;
  const width = people.length * size + (people.length - 1) * gap;
  const spots: Record<string, Spot> = {};
  people.forEach((person, index) => {
    spots[person.key] = {
      x: center.x - width / 2 + index * (size + gap),
      y: center.y - size / 2,
      size,
    };
  });
  return spots;
}

/** A spot moved by a distance in page units. */
export const moved = (spot: Spot, dx: number, dy: number): Spot => ({
  ...spot,
  x: spot.x + dx,
  y: spot.y + dy,
});

/** A spot sized from its bottom right corner, which is dragged by `d` (page units): the top left stays. */
export const sized = (spot: Spot, dx: number, dy: number): Spot => ({
  ...spot,
  size: clampSize(spot.size + Math.max(dx, dy)),
});

/** Where a spot is on screen, given the camera and its zoom. */
export function onScreen(
  spot: Spot,
  camera: { x: number; y: number; z: number },
) {
  return {
    left: (spot.x + camera.x) * camera.z,
    top: (spot.y + camera.y) * camera.z,
    size: spot.size * camera.z,
  };
}

export const sameSpot = (a?: Spot, b?: Spot) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.size === b.size;
