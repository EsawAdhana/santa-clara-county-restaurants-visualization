const mapImageWidth = 1664;
const mapImageHeight = 1393;
const mapWestLon = -122.20085766666666;
const mapEastLon = -121.27442433333333;
const mapSouthLat = 36.91311264279123;
const mapNorthLat = 37.53067882428926;

// Draw the map at half size so it fits on screen
const mapScale = 2;
const mapWidth = mapImageWidth / mapScale;
const mapHeight = mapImageHeight / mapScale;

const mapFrameGeoJSON = {
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: [
      [mapWestLon, mapSouthLat],
      [mapEastLon, mapNorthLat]
    ]
  }
};

// projection([lon, lat]) -> [x, y]
const projection = d3.geoMercator()
  .fitExtent([[0, 0], [mapWidth, mapHeight]], mapFrameGeoJSON);

// +1° of latitude N or S = ~69 miles
const milesPerDegreeLat = 69;

// 1 mile = pxPerMile pixels
const midLon = (mapWestLon + mapEastLon) / 2;
const midLat = (mapSouthLat + mapNorthLat) / 2;
const oneMileNorth = midLat + 1 / milesPerDegreeLat;
const pxPerMile = projection([midLon, midLat])[1] - projection([midLon, oneMileNorth])[1];

const svg = d3.select("#map")
  .append("svg")
  .attr("width", mapWidth)
  .attr("height", mapHeight);

svg.append("image")
  .attr("width", mapWidth)
  .attr("height", mapHeight)
  .attr("href", "data/sccRestaurantsMap2026.png");

const tooltip = d3.select("#tooltip");

// The two query circles. x and y are pixels on the map, radius is in miles
const circles = [
  { name: "A", color: "#d62728", radius: 3 },
  { name: "B", color: "#2ca02c", radius: 3 }
];
[circles[0].x, circles[0].y] = projection([-122.08, 37.40]);
[circles[1].x, circles[1].y] = projection([-122.03, 37.37]);

// The CSV uses the string "null" for missing numbers
function num(s) {
  return s === "null" ? null : +s;
}

function parseRow(row) {
  return {
    name: row["Facility Name"],
    address: row["Address"],
    placard: row["Latest placard color"].replace(" *", ""), // "Pass *" -> "Pass" for cleanliness
    score: num(row["Latest Score"]),
    lat: num(row["Latitude"]),
    lon: num(row["Longitude"]),
    rating: num(row["Rating"]),
    reviews: num(row["Number of reviews"])
  };
}

d3.csv("data/sccRestaurantsSynth2026.csv", parseRow).then(data => {
  // Ignoring null latitudes/longitudes
  const restaurants = data.filter(d => d.lat !== null && d.lon !== null);
  for (const d of restaurants) {
    [d.x, d.y] = projection([d.lon, d.lat]);
    d.text = (d.name + " " + d.address).toLowerCase();
  }

  // Many dots sit on top of each other (eg. Valley Fair mall), so the
  // tooltip flips through every restaurant whose dot overlaps the one under the mouse.
  // tip.x/y is that dot's position, tip.index is which restaurant is showing, and pinned
  // means it was clicked open.
  const dotRadius = 1.8;
  const tip = { x: 0, y: 0, index: 0, count: 0, pinned: false };

  const dots = svg.append("g")
    .selectAll("circle")
    .data(restaurants)
    .join("circle")
    .attr("class", "dot")
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", dotRadius)
    .on("mouseover", (event, d) => {
      if (tip.pinned) return;
      [tip.x, tip.y] = [d.x, d.y];
      tip.index = 0;
      showTooltip();
      moveTooltip(event);
    })
    .on("mousemove", event => {
      if (!tip.pinned) moveTooltip(event);
    })
    .on("mouseout", () => {
      if (!tip.pinned) hideTooltip();
    })
    // Clicking a dot keeps the tooltip open so its arrows can be clicked
    .on("click", (event, d) => {
      event.stopPropagation(); // prevent click handler from immediately closing tip
      [tip.x, tip.y] = [d.x, d.y];
      tip.index = 0;
      tip.pinned = true;
      showTooltip();
      moveTooltip(event);
    });

  // Clicking anywhere else on the map closes a clicked-open tooltip
  svg.on("click", hideTooltip);

  // Query circles go on top of the dots. Drag the lettered center to move.
  const groups = svg.append("g")
    .selectAll("g")
    .data(circles)
    .join("g");

  groups.append("circle")
    .attr("class", "ring")
    .attr("stroke", c => c.color);

  groups.append("circle")
    .attr("class", "handle")
    .attr("r", 9)
    .attr("fill", c => c.color)
    .call(d3.drag().on("drag", (event, c) => {
      c.x = Math.max(0, Math.min(mapWidth, event.x));
      c.y = Math.max(0, Math.min(mapHeight, event.y));
      update();
    }));

  groups.append("text")
    .attr("class", "handle-label")
    .text(c => c.name);

  // Placard color checkboxes
  const placards = ["Green", "Yellow", "Red", "Pass", "Closure", "N/A"];
  const shownPlacards = new Set(placards);

  const placardLabels = d3.select("#placards")
    .selectAll("label")
    .data(placards)
    .join("label");
  placardLabels.append("input")
    .attr("type", "checkbox")
    .property("checked", true)
    .on("change", function (event, p) {
      if (this.checked) shownPlacards.add(p);
      else shownPlacards.delete(p);
      update();
    });
  placardLabels.append("span")
    .text(p => " " + p);

  d3.selectAll("#radiusA, #radiusB, #minRating, #keyword").on("input", update);

  // Reads every control, redraws the circles, and grays out restaurants that don't match
  function update() {
    const start = performance.now();

    circles[0].radius = +d3.select("#radiusA").property("value");
    circles[1].radius = +d3.select("#radiusB").property("value");
    const minRating = +d3.select("#minRating").property("value");
    const keyword = d3.select("#keyword").property("value").trim().toLowerCase();

    groups.select(".ring")
      .attr("cx", c => c.x)
      .attr("cy", c => c.y)
      .attr("r", c => c.radius * pxPerMile);
    groups.select(".handle")
      .attr("cx", c => c.x)
      .attr("cy", c => c.y);
    groups.select(".handle-label")
      .attr("x", c => c.x)
      .attr("y", c => c.y);

    let count = 0;
    for (const d of restaurants) {
      d.match = insideBoth(d)
        && shownPlacards.has(d.placard)
        && d.rating >= minRating
        && d.text.includes(keyword);
      if (d.match) count++;
    }
    dots.classed("off", d => !d.match);

    d3.select("#radiusA-val").text(circles[0].radius + " mi");
    d3.select("#radiusB-val").text(circles[1].radius + " mi");
    d3.select("#minRating-val").text(minRating.toFixed(1));
    d3.select("#status").text(
      `${count} of ${restaurants.length} restaurants on the map match ` +
      `(${data.length - restaurants.length} more have no location). ` +
      `Filtered in ${(performance.now() - start).toFixed(1)} ms.`
    );

    if (tip.pinned) showTooltip();
  }

  function insideBoth(d) {
    for (const c of circles) {
      const r = c.radius * pxPerMile;
      if ((d.x - c.x) ** 2 + (d.y - c.y) ** 2 > r * r) return false;
    }
    return true;
  }

  // Tooltip: one restaurant at a time from the dots under the mouse, counting only the ones
  // that pass the filters. Shows the name plus whichever fields aren't missing, and "1 of N"
  // when there are several.
  function showTooltip() {
    const dist = r => (r.x - tip.x) ** 2 + (r.y - tip.y) ** 2;
    const here = restaurants
      .filter(r => r.match && dist(r) <= (2 * dotRadius) ** 2)
      .sort((a, b) => dist(a) - dist(b)); // the dot under the mouse comes first
    if (here.length === 0) {
      hideTooltip();
      return;
    }
    tip.count = here.length;
    tip.index = tip.index % tip.count; // in case the filters shrunk the list
    const d = here[tip.index];

    tooltip.html("").style("display", "block").classed("pinned", tip.pinned);

    if (tip.count > 1) {
      const nav = tooltip.append("div").attr("class", "nav");
      if (tip.pinned) nav.append("button").text("←").on("click", () => flip(-1));
      nav.append("span").text(` ${tip.index + 1} of ${tip.count} `);
      if (tip.pinned) nav.append("button").text("→").on("click", () => flip(1));
    }

    tooltip.append("b").text(d.name);
    const fields = [
      ["Address", d.address],
      ["Rating", d.rating],
      ["Reviews", d.reviews],
      ["Latest score", d.score],
      ["Placard", d.placard === "N/A" ? null : d.placard]
    ];
    for (const [label, value] of fields) {
      if (value !== null) tooltip.append("div").text(`${label}: ${value}`);
    }

    if (tip.pinned) {
      tooltip.append("div").attr("class", "hint").text("Click the map to close.");
    } else if (tip.count > 1) {
      tooltip.append("div").attr("class", "hint").text(`Click to flip through all ${tip.count}.`);
    }
  }

  // Goes to the previous (-1) or next (+1) restaurant, wrapping around at the ends.
  function flip(step) {
    tip.index = (tip.index + step + tip.count) % tip.count;
    showTooltip();
  }

  function moveTooltip(event) {
    const [x, y] = d3.pointer(event, document.getElementById("map"));
    tooltip.style("left", x + 12 + "px").style("top", y + 12 + "px"); // 12 pixel offset for the tooltip
  }

  function hideTooltip() {
    tip.pinned = false;
    tooltip.style("display", "none");
  }

  update();
});
