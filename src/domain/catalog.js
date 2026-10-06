// Curated catalog of real, well-known public places.
// Coordinates are approximate (for distance estimates only). Opening hours,
// prices and closures are intentionally NOT stored: the assistant always tells
// people to check them, rather than inventing facts.
//
// exposure: 'outdoor' – weather ruins it, 'view' – indoors-ish but the point is
// the view, 'indoor' – fine in the rain.
// These are planning hints, not guarantees of shelter or current access.
// Even museums may include outdoor areas; verify opening and seating details.

const p = (id, name, kind, exposure, minutes, lat, lon, area, tags, note) =>
  Object.freeze({ id, name, kind, exposure, minutes, lat, lon, area, tags: Object.freeze(tags), note });

export const CITIES = Object.freeze({
  kyoto: Object.freeze({
    id: 'kyoto',
    name: 'Kyoto',
    country: 'Japan',
    timezone: 'Asia/Tokyo',
    lat: 35.0116,
    lon: 135.7681,
    places: Object.freeze([
      p('kyo-fushimi-inari', 'Fushimi Inari Taisha', 'walk', 'outdoor', 120, 34.9671, 135.7727, 'Fushimi', ['culture', 'nature', 'views'], 'Thousands of vermilion gates up the mountain. Go early to beat the crowds.'),
      p('kyo-kiyomizu', 'Kiyomizu-dera', 'walk', 'view', 90, 34.9949, 135.785, 'Higashiyama', ['culture', 'views'], 'The wooden stage looks out over the city.'),
      p('kyo-ninenzaka', 'Sannenzaka & Ninenzaka lanes', 'shop', 'outdoor', 60, 34.9965, 135.781, 'Higashiyama', ['shopping', 'culture', 'food'], 'Stone-paved slopes lined with small shops.'),
      p('kyo-gion', 'Gion & Hanamikoji Street', 'walk', 'outdoor', 60, 35.0037, 135.7752, 'Gion', ['culture'], 'Historic teahouse district. Please respect private alleys.'),
      p('kyo-philosophers-path', "Philosopher's Path", 'walk', 'outdoor', 75, 35.027, 135.7948, 'Northern Higashiyama', ['nature'], 'A quiet canal-side walk.'),
      p('kyo-ginkakuji', 'Ginkaku-ji', 'walk', 'outdoor', 60, 35.027, 135.7982, 'Northern Higashiyama', ['culture', 'nature'], 'Moss garden and raked sand.'),
      p('kyo-arashiyama-bamboo', 'Arashiyama Bamboo Grove', 'walk', 'outdoor', 60, 35.017, 135.6713, 'Arashiyama', ['nature', 'views'], 'Towering bamboo, best in the morning.'),
      p('kyo-tenryuji', 'Tenryu-ji Garden', 'walk', 'outdoor', 60, 35.0158, 135.6738, 'Arashiyama', ['culture', 'nature'], 'A classic pond garden next to the bamboo grove.'),
      p('kyo-kinkakuji', 'Kinkaku-ji', 'walk', 'outdoor', 60, 35.0394, 135.7292, 'Kitayama', ['culture', 'views'], 'The Golden Pavilion reflected in its pond.'),
      p('kyo-nijo', 'Nijo Castle', 'walk', 'outdoor', 90, 35.0142, 135.7481, 'Central Kyoto', ['culture'], 'Palace interiors plus large gardens.'),
      p('kyo-national-museum', 'Kyoto National Museum', 'indoor', 'indoor', 90, 34.99, 135.7732, 'Higashiyama', ['culture'], 'Japanese art and treasures. Check the current exhibition.'),
      p('kyo-railway-museum', 'Kyoto Railway Museum', 'indoor', 'indoor', 90, 34.9873, 135.7425, 'Umekoji', ['culture', 'family'], 'Steam locomotives to bullet trains.'),
      p('kyo-kyocera-museum', 'Kyoto City KYOCERA Museum of Art', 'indoor', 'indoor', 90, 35.0128, 135.7826, 'Okazaki', ['culture'], 'Modern and historic Japanese art.'),
      p('kyo-manga-museum', 'Kyoto International Manga Museum', 'indoor', 'indoor', 90, 35.0117, 135.759, 'Central Kyoto', ['culture', 'family'], 'A former school full of manga you can read.'),
      p('kyo-aquarium', 'Kyoto Aquarium', 'indoor', 'indoor', 90, 34.9877, 135.7461, 'Umekoji', ['family'], 'Giant salamanders and a dolphin show.'),
      p('kyo-teramachi', 'Teramachi & Shinkyogoku covered arcades', 'shop', 'indoor', 60, 35.006, 135.768, 'Downtown', ['shopping'], 'Covered shopping streets, good when it rains.'),
      p('kyo-nishiki', 'Nishiki Market', 'food', 'indoor', 60, 35.005, 135.7649, 'Downtown', ['food', 'shopping'], 'A covered market street of food stalls.'),
      p('kyo-ramen-koji', 'Kyoto Ramen Koji (Kyoto Station)', 'food', 'indoor', 50, 34.9852, 135.7585, 'Kyoto Station', ['food'], 'Ramen shops inside the station building.'),
      p('kyo-pontocho', 'Pontocho Alley', 'food', 'indoor', 75, 35.0055, 135.7712, 'Downtown', ['food'], 'Narrow lane of restaurants by the river.'),
      p('kyo-inoda', 'Inoda Coffee (main shop)', 'coffee', 'indoor', 45, 35.0076, 135.7618, 'Downtown', ['coffee'], 'A classic Kyoto coffee house.'),
      p('kyo-smart-coffee', 'Smart Coffee', 'coffee', 'indoor', 40, 35.0109, 135.7679, 'Downtown', ['coffee'], 'Retro kissaten known for pancakes.'),
      p('kyo-weekenders', 'Weekenders Coffee Tominokoji', 'coffee', 'outdoor', 30, 35.0073, 135.7634, 'Downtown', ['coffee'], 'Small specialty roaster tucked behind a parking lot. Do not rely on indoor seating or shelter.'),
      p('kyo-kurasu', 'Kurasu Kyoto Stand', 'coffee', 'indoor', 30, 34.9884, 135.757, 'Kyoto Station', ['coffee'], 'Specialty coffee near the station.'),
      p('kyo-arabica-arashiyama', '% Arabica Arashiyama', 'coffee', 'outdoor', 25, 35.0137, 135.6775, 'Arashiyama', ['coffee', 'views'], 'Takeaway coffee by the river; little seating.'),
    ]),
  }),
  seattle: Object.freeze({
    id: 'seattle',
    name: 'Seattle',
    country: 'USA',
    timezone: 'America/Los_Angeles',
    lat: 47.6062,
    lon: -122.3321,
    places: Object.freeze([
      p('sea-pike-place', 'Pike Place Market', 'food', 'indoor', 75, 47.6097, -122.3422, 'Downtown', ['food', 'shopping'], 'Covered market with produce, fish and small eateries.'),
      p('sea-space-needle', 'Space Needle', 'walk', 'view', 60, 47.6205, -122.3493, 'Seattle Center', ['views'], 'The view is the point; low clouds hide it.'),
      p('sea-chihuly', 'Chihuly Garden and Glass', 'indoor', 'indoor', 75, 47.6206, -122.3505, 'Seattle Center', ['culture'], 'Glass art galleries plus an outdoor garden.'),
      p('sea-mopop', 'Museum of Pop Culture (MoPOP)', 'indoor', 'indoor', 90, 47.6215, -122.3481, 'Seattle Center', ['culture', 'family'], 'Music, sci-fi and games exhibits.'),
      p('sea-sculpture-park', 'Olympic Sculpture Park', 'walk', 'outdoor', 45, 47.6166, -122.3553, 'Belltown', ['culture', 'views', 'nature'], 'Free waterfront sculpture park.'),
      p('sea-waterfront', 'Seattle Waterfront promenade', 'walk', 'outdoor', 60, 47.6062, -122.3425, 'Waterfront', ['views'], 'Piers and views of Elliott Bay.'),
      p('sea-art-museum', 'Seattle Art Museum', 'indoor', 'indoor', 90, 47.6073, -122.3381, 'Downtown', ['culture'], 'Art from around the world.'),
      p('sea-central-library', 'Seattle Central Library', 'indoor', 'indoor', 45, 47.6067, -122.3325, 'Downtown', ['culture'], 'Striking glass-and-steel architecture, free to visit.'),
      p('sea-aquarium', 'Seattle Aquarium', 'indoor', 'indoor', 90, 47.6075, -122.343, 'Waterfront', ['family', 'nature'], 'Sea otters and Puget Sound marine life.'),
      p('sea-kerry-park', 'Kerry Park viewpoint', 'walk', 'view', 30, 47.6295, -122.3599, 'Queen Anne', ['views'], 'Postcard skyline view.'),
      p('sea-discovery-park', 'Discovery Park', 'walk', 'outdoor', 120, 47.6573, -122.4055, 'Magnolia', ['nature', 'views'], 'Bluffs, forest trails and a lighthouse.'),
      p('sea-ballard-locks', 'Ballard Locks', 'walk', 'outdoor', 60, 47.6654, -122.3972, 'Ballard', ['nature', 'family'], 'Boats move between lake and sound; fish ladder in season.'),
      p('sea-fremont-troll', 'Fremont Troll', 'walk', 'outdoor', 20, 47.651, -122.3473, 'Fremont', ['culture'], 'A giant troll under a bridge.'),
      p('sea-museum-of-flight', 'The Museum of Flight', 'indoor', 'indoor', 120, 47.518, -122.2964, 'Boeing Field', ['culture', 'family'], 'Aircraft and spaceflight history.'),
      p('sea-pioneer-square', 'Pioneer Square', 'walk', 'outdoor', 45, 47.6015, -122.3343, 'Pioneer Square', ['culture', 'shopping'], 'Historic brick district.'),
      p('sea-reserve-roastery', 'Starbucks Reserve Roastery', 'coffee', 'indoor', 45, 47.6141, -122.3281, 'Capitol Hill', ['coffee'], 'A large roastery and cafe.'),
      p('sea-elm-coffee', 'Elm Coffee Roasters', 'coffee', 'indoor', 30, 47.599, -122.333, 'Pioneer Square', ['coffee'], 'Specialty roaster in Pioneer Square.'),
      p('sea-storyville', 'Storyville Coffee Pike Place', 'coffee', 'indoor', 30, 47.6088, -122.3405, 'Downtown', ['coffee', 'views'], 'Cozy upstairs cafe in the market.'),
      p('sea-caffe-vita', 'Caffe Vita Capitol Hill', 'coffee', 'indoor', 30, 47.6139, -122.3195, 'Capitol Hill', ['coffee'], 'Long-running local roaster.'),
      p('sea-capitol-hill-dinner', 'Dinner on Capitol Hill', 'food', 'indoor', 75, 47.6153, -122.3201, 'Capitol Hill', ['food'], 'Lots of restaurants around Pike/Pine.'),
      p('sea-ballard-ave', 'Ballard Avenue lunch', 'food', 'indoor', 60, 47.6667, -122.3838, 'Ballard', ['food', 'shopping'], 'Brick street of cafes and restaurants.'),
    ]),
  }),
});

export const CITY_IDS = Object.freeze(Object.keys(CITIES));
export const INTERESTS = Object.freeze(['coffee', 'food', 'culture', 'nature', 'shopping', 'views', 'family']);
export const PACES = Object.freeze(['relaxed', 'balanced', 'packed']);

export function getCity(cityId) {
  const city = CITIES[String(cityId || '').toLowerCase()];
  if (!city) throw new Error(`Unsupported city "${cityId}". Supported: ${CITY_IDS.join(', ')}.`);
  return city;
}

export function getPlace(cityId, placeId) {
  return getCity(cityId).places.find((pl) => pl.id === placeId) || null;
}
