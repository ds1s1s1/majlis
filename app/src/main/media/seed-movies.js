'use strict';
// Curated primary metadata fallback seed pool with normalized canonical genres so Group Taste
// Matcher and keyless catalogs never hit empty or untagged pools, even on unusual combinations.

const METAHUB_POSTER = (id) => `https://images.metahub.space/poster/medium/${id}/img`;
const METAHUB_BG = (id) => `https://images.metahub.space/background/medium/${id}/img`;

// [imdbId, name, year, runtimeMin, imdbRating, genres[]]
const SEED_ROWS = [
  // Pre-1990 Classics across Fantasy / Comedy / Horror / Action / Sci-Fi / Drama / Animation / War
  ['tt0094721', 'Beetlejuice', 1988, 92, '7.5', ['Comedy', 'Fantasy', 'Horror']],
  ['tt0087332', 'Ghostbusters', 1984, 105, '7.8', ['Action', 'Comedy', 'Fantasy', 'Horror']],
  ['tt0087363', 'Gremlins', 1984, 106, '7.3', ['Comedy', 'Fantasy', 'Horror']],
  ['tt0092991', 'Evil Dead II', 1987, 84, '7.7', ['Comedy', 'Fantasy', 'Horror']],
  ['tt0091419', 'Little Shop of Horrors', 1986, 94, '7.1', ['Comedy', 'Fantasy', 'Horror', 'Romance']],
  ['tt0090728', 'Big Trouble in Little China', 1986, 99, '7.2', ['Action', 'Adventure', 'Comedy', 'Fantasy']],
  ['tt0082010', 'An American Werewolf in London', 1981, 97, '7.5', ['Comedy', 'Fantasy', 'Horror']],
  ['tt0093560', 'The Monster Squad', 1987, 82, '7.0', ['Action', 'Comedy', 'Fantasy', 'Horror', 'Family']],
  ['tt0093779', 'The Princess Bride', 1987, 98, '8.0', ['Adventure', 'Comedy', 'Family', 'Fantasy', 'Romance']],
  ['tt0091369', 'Labyrinth', 1986, 101, '7.3', ['Adventure', 'Family', 'Fantasy']],
  ['tt0094625', 'Akira', 1988, 124, '8.0', ['Animation', 'Action', 'Sci-Fi', 'Thriller']],
  ['tt0095016', 'Die Hard', 1988, 132, '8.2', ['Action', 'Thriller']],
  ['tt0084787', 'The Thing', 1982, 109, '8.2', ['Horror', 'Mystery', 'Sci-Fi', 'Thriller']],
  ['tt0078748', 'Alien', 1979, 117, '8.5', ['Horror', 'Sci-Fi', 'Thriller']],
  ['tt0083658', 'Blade Runner', 1982, 117, '8.1', ['Drama', 'Mystery', 'Sci-Fi', 'Thriller']],
  ['tt0088763', 'Back to the Future', 1985, 116, '8.5', ['Adventure', 'Comedy', 'Sci-Fi', 'Family']],
  ['tt0095765', 'Cinema Paradiso', 1988, 155, '8.5', ['Drama', 'Romance']],
  ['tt0095327', 'Grave of the Fireflies', 1988, 89, '8.5', ['Animation', 'Drama', 'War']],
  ['tt0091251', 'Come and See', 1985, 142, '8.4', ['Drama', 'History', 'War', 'Thriller']],
  ['tt0050083', '12 Angry Men', 1957, 96, '9.0', ['Crime', 'Drama']],
  ['tt0073195', 'Jaws', 1975, 124, '8.1', ['Adventure', 'Horror', 'Thriller']],
  ['tt0082971', 'Raiders of the Lost Ark', 1981, 115, '8.4', ['Action', 'Adventure']],
  ['tt0075148', 'Rocky', 1976, 120, '8.1', ['Drama', 'Romance']],
  ['tt0068646', 'The Godfather', 1972, 175, '9.2', ['Crime', 'Drama']],
  ['tt0096283', 'My Neighbor Totoro', 1988, 86, '8.1', ['Animation', 'Comedy', 'Family', 'Fantasy']],
  ['tt0090605', 'Aliens', 1986, 137, '8.4', ['Action', 'Adventure', 'Horror', 'Sci-Fi', 'Thriller']],

  // 1990s Multi-genre Essentials
  ['tt0107048', 'Groundhog Day', 1993, 101, '8.0', ['Comedy', 'Drama', 'Fantasy', 'Romance']],
  ['tt0120762', 'The Mummy', 1999, 124, '7.1', ['Action', 'Adventure', 'Comedy', 'Fantasy', 'Horror']],
  ['tt0110912', 'Pulp Fiction', 1994, 154, '8.9', ['Crime', 'Drama', 'Thriller']],
  ['tt0111161', 'The Shawshank Redemption', 1994, 142, '9.3', ['Drama', 'Crime']],
  ['tt0114369', 'Se7en', 1995, 127, '8.6', ['Crime', 'Drama', 'Mystery', 'Thriller']],
  ['tt0133093', 'The Matrix', 1999, 136, '8.7', ['Action', 'Sci-Fi']],
  ['tt0120815', 'Saving Private Ryan', 1998, 169, '8.6', ['Action', 'Drama', 'History', 'War']],
  ['tt0119698', 'Princess Mononoke', 1997, 134, '8.3', ['Animation', 'Adventure', 'Fantasy', 'Drama']],
  ['tt0114709', 'Toy Story', 1995, 81, '8.3', ['Animation', 'Adventure', 'Comedy', 'Family', 'Fantasy']],
  ['tt0102926', 'The Silence of the Lambs', 1991, 118, '8.6', ['Crime', 'Drama', 'Horror', 'Thriller']],
  ['tt0118799', 'Life Is Beautiful', 1997, 116, '8.6', ['Comedy', 'Drama', 'Romance', 'War']],
  ['tt0107688', 'The Nightmare Before Christmas', 1993, 76, '7.9', ['Animation', 'Comedy', 'Family', 'Fantasy', 'Horror']],
  ['tt0108052', "Schindler's List", 1993, 195, '9.0', ['Drama', 'History', 'War']],
  ['tt0109830', 'Forrest Gump', 1994, 142, '8.8', ['Comedy', 'Drama', 'Romance']],
  ['tt0120382', 'The Truman Show', 1998, 103, '8.2', ['Comedy', 'Drama', 'Sci-Fi']],
  ['tt0113277', 'Heat', 1995, 170, '8.3', ['Action', 'Crime', 'Drama', 'Thriller']],

  // 2000s Multi-genre Essentials
  ['tt0365748', 'Shaun of the Dead', 2004, 99, '7.9', ['Comedy', 'Horror', 'Action']],
  ['tt0457430', "Pan's Labyrinth", 2006, 118, '8.2', ['Drama', 'Fantasy', 'Horror', 'War']],
  ['tt0245429', 'Spirited Away', 2001, 125, '8.6', ['Animation', 'Adventure', 'Family', 'Fantasy']],
  ['tt0120737', 'The Lord of the Rings: The Fellowship of the Ring', 2001, 178, '8.9', ['Action', 'Adventure', 'Drama', 'Fantasy']],
  ['tt0468569', 'The Dark Knight', 2008, 152, '9.0', ['Action', 'Crime', 'Drama', 'Thriller']],
  ['tt0364569', 'Oldboy', 2003, 120, '8.3', ['Action', 'Drama', 'Mystery', 'Thriller']],
  ['tt0353969', 'Memories of Murder', 2003, 131, '8.1', ['Crime', 'Drama', 'Mystery', 'Thriller']],
  ['tt0338013', 'Eternal Sunshine of the Spotless Mind', 2004, 108, '8.3', ['Drama', 'Romance', 'Sci-Fi']],
  ['tt0172495', 'Gladiator', 2000, 155, '8.5', ['Action', 'Adventure', 'Drama', 'History']],
  ['tt0910970', 'WALL-E', 2008, 98, '8.4', ['Animation', 'Adventure', 'Family', 'Romance', 'Sci-Fi']],
  ['tt0407887', 'The Departed', 2006, 151, '8.5', ['Crime', 'Drama', 'Thriller']],
  ['tt0253474', 'The Pianist', 2002, 150, '8.5', ['Drama', 'History', 'War']],
  ['tt0317705', 'The Incredibles', 2004, 115, '8.0', ['Animation', 'Action', 'Adventure', 'Comedy', 'Family']],
  ['tt0361748', 'Inglourious Basterds', 2009, 153, '8.4', ['Adventure', 'Comedy', 'Drama', 'War']],

  // 2010s Multi-genre Essentials
  ['tt1259521', 'The Cabin in the Woods', 2011, 95, '7.0', ['Comedy', 'Fantasy', 'Horror', 'Mystery', 'Thriller']],
  ['tt3416742', 'What We Do in the Shadows', 2014, 86, '7.6', ['Comedy', 'Fantasy', 'Horror']],
  ['tt1375666', 'Inception', 2010, 148, '8.8', ['Action', 'Adventure', 'Sci-Fi', 'Thriller']],
  ['tt0816692', 'Interstellar', 2014, 169, '8.7', ['Adventure', 'Drama', 'Sci-Fi']],
  ['tt6751668', 'Parasite', 2019, 132, '8.5', ['Comedy', 'Drama', 'Thriller']],
  ['tt1392190', 'Mad Max: Fury Road', 2015, 120, '8.1', ['Action', 'Adventure', 'Sci-Fi', 'Thriller']],
  ['tt2543164', 'Arrival', 2016, 116, '7.9', ['Drama', 'Mystery', 'Sci-Fi']],
  ['tt4633694', 'Spider-Man: Into the Spider-Verse', 2018, 117, '8.4', ['Animation', 'Action', 'Adventure', 'Comedy', 'Family', 'Sci-Fi']],
  ['tt5052448', 'Get Out', 2017, 104, '7.8', ['Horror', 'Mystery', 'Thriller']],
  ['tt8946378', 'Knives Out', 2019, 130, '7.9', ['Comedy', 'Crime', 'Drama', 'Mystery']],
  ['tt2278388', 'The Grand Budapest Hotel', 2014, 99, '8.1', ['Adventure', 'Comedy', 'Crime', 'Drama']],
  ['tt1798709', 'Her', 2013, 126, '8.0', ['Drama', 'Romance', 'Sci-Fi']],
  ['tt2380307', 'Coco', 2017, 105, '8.4', ['Animation', 'Adventure', 'Comedy', 'Family', 'Fantasy']],
  ['tt2582802', 'Whiplash', 2014, 106, '8.5', ['Drama', 'Thriller']],
  ['tt8579674', '1917', 2019, 119, '8.2', ['Action', 'Drama', 'History', 'War']],
  ['tt1136608', 'District 9', 2009, 112, '7.9', ['Action', 'Sci-Fi', 'Thriller']],
  ['tt7775622', 'Free Solo', 2018, 100, '8.1', ['Documentary', 'Adventure']],
  ['tt2396224', '20 Feet from Stardom', 2013, 91, '7.4', ['Documentary', 'History']],

  // 2020s Multi-genre Essentials
  ['tt6710474', 'Everything Everywhere All at Once', 2022, 139, '7.8', ['Action', 'Adventure', 'Comedy', 'Fantasy', 'Sci-Fi']],
  ['tt1160419', 'Dune', 2021, 155, '8.0', ['Action', 'Adventure', 'Drama', 'Sci-Fi']],
  ['tt15239678', 'Dune: Part Two', 2024, 166, '8.5', ['Action', 'Adventure', 'Drama', 'Sci-Fi']],
  ['tt15398776', 'Oppenheimer', 2023, 180, '8.3', ['Drama', 'History', 'Thriller']],
  ['tt9362722', 'Spider-Man: Across the Spider-Verse', 2023, 140, '8.5', ['Animation', 'Action', 'Adventure', 'Fantasy', 'Sci-Fi']],
  ['tt3915174', 'Puss in Boots: The Last Wish', 2022, 102, '7.8', ['Animation', 'Adventure', 'Comedy', 'Family', 'Fantasy']],
  ['tt16426418', 'The Wild Robot', 2024, 102, '8.2', ['Animation', 'Adventure', 'Family', 'Sci-Fi']],
  ['tt29623480', 'The Wild Robot (alt)', 2024, 102, '8.2', ['Animation', 'Sci-Fi']], // dedup check placeholder replaced below
  ['tt23289160', 'Godzilla Minus One', 2023, 124, '7.7', ['Action', 'Adventure', 'Drama', 'History', 'Horror', 'Sci-Fi']],
  ['tt10872600', 'Spider-Man: No Way Home', 2021, 148, '8.2', ['Action', 'Adventure', 'Fantasy', 'Sci-Fi']],
  ['tt12735488', 'Kalki 2898-AD', 2024, 181, '7.0', ['Action', 'Adventure', 'Fantasy', 'Sci-Fi']],
  ['tt14849194', 'The Holdovers', 2023, 133, '7.9', ['Comedy', 'Drama']],
  ['tt27075958', '20 Days in Mariupol', 2023, 94, '8.5', ['Documentary', 'War', 'History']],
  ['tt16244174', 'Fire of Love', 2022, 93, '7.6', ['Documentary', 'Romance', 'Adventure']],
  ['tt17009710', 'Anatomy of a Fall', 2023, 151, '7.7', ['Crime', 'Drama', 'Mystery', 'Thriller']],
].filter((r) => r[0] !== 'tt29623480');

const SEED_MOVIES = SEED_ROWS.map(([id, name, year, runtimeMin, imdbRating, genres]) => ({
  id,
  type: 'movie',
  name,
  poster: METAHUB_POSTER(id),
  background: METAHUB_BG(id),
  year,
  releaseInfo: String(year),
  runtime: `${runtimeMin} min`,
  runtimeMin,
  imdbRating,
  genres,
}));

const SEED_GENRES_BY_ID = Object.fromEntries(SEED_MOVIES.map((m) => [m.id, m.genres]));

module.exports = { SEED_MOVIES, SEED_GENRES_BY_ID };
