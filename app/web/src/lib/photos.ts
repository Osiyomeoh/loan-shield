// People photos, free under the Unsplash License (https://unsplash.com/license), served from Unsplash's image CDN.
// Each one was checked on its Unsplash page ("Free Photo on Unsplash"); the photographer is credited where it shows.
export type Photo = { id: string; page: string; by: string; alt: string };

export const PHOTOS = {
  night: {
    id: "photo-1506377711776-dbdc2f3c20d9",
    page: "https://unsplash.com/photos/woman-looking-at-phone-beside-body-of-water-QofjUnxy9LY",
    by: "Becca Tapert",
    alt: "A woman checks her phone by a lake at dusk",
  },
  worried: {
    id: "photo-1517940322679-2b003a168fd2",
    page: "https://unsplash.com/photos/woman-leaning-on-white-wooden-table-while-holding-black-android-smartphone-w3jVXGkYZCw",
    by: "Kev Costello",
    alt: "A woman leans on a table, looking at her phone",
  },
  calm: {
    id: "photo-1612832164313-ac0d7e07b5ce",
    page: "https://unsplash.com/photos/person-sitting-on-couch-holding-a-surface-device-8HPLpr3hebU",
    by: "Surface",
    alt: "A smiling woman relaxes on a sofa with a laptop",
  },
  team: {
    id: "photo-1522202176988-66273c2fd55f",
    page: "https://unsplash.com/photos/three-people-sitting-in-front-of-table-laughing-together-g1Kr4Ozfoac",
    by: "Brooke Cagle",
    alt: "Three people laugh together around a table with laptops",
  },
  builder: {
    id: "photo-1623479322729-28b25c16b011",
    page: "https://unsplash.com/photos/man-in-black-long-sleeve-shirt-using-computer-_Fx34KeqIEw",
    by: "Mohammad Rahmani",
    alt: "A developer works at a computer late at night",
  },
} satisfies Record<string, Photo>;

export const photoSrc = (p: Photo, width: number) => `https://images.unsplash.com/${p.id}?auto=format&fit=crop&w=${width}&q=78`;
export const photoSrcSet = (p: Photo) => [480, 800, 1200, 1600].map((w) => `${photoSrc(p, w)} ${w}w`).join(", ");
