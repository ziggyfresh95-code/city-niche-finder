// Curated niche database for the random niche suggester.
// Grouped by category so results feel varied, mirroring NFP's "50+ niches
// across 10 categories" idea. These are classic local rank-and-rent niches:
// service businesses with high job value and low web sophistication.
const NICHE_DB = {
  "Home Exterior": [
    "Roofing", "Gutter cleaning", "Gutter installation", "Pressure washing",
    "Window cleaning", "Siding installation", "Chimney sweep", "Solar panel cleaning",
    "Deck building", "Fence installation", "Fence repair"
  ],
  "Home Interior": [
    "Painting", "Interior painting", "Cabinet refinishing", "Flooring installation",
    "Epoxy flooring", "Drywall repair", "Basement waterproofing", "Popcorn ceiling removal",
    "Handyman services", "Home remodeling", "Kitchen remodeling", "Bathroom remodeling"
  ],
  "Concrete & Masonry": [
    "Concrete driveway", "Concrete contractor", "Stamped concrete", "Paver installation",
    "Retaining walls", "Foundation repair", "Brick repair", "Asphalt paving"
  ],
  "Landscaping & Outdoor": [
    "Landscaping", "Lawn care", "Tree removal", "Tree trimming", "Stump grinding",
    "Sod installation", "Sprinkler repair", "Artificial turf installation",
    "Land clearing", "Excavation", "Junk removal", "Snow removal"
  ],
  "Automotive": [
    "Mobile mechanic", "Auto detailing", "Mobile detailing", "Window tinting",
    "Auto glass repair", "Towing", "Paintless dent repair", "Ceramic coating"
  ],
  "Cleaning": [
    "House cleaning", "Commercial cleaning", "Carpet cleaning", "Tile and grout cleaning",
    "Move out cleaning", "Air duct cleaning", "Dryer vent cleaning", "Post construction cleaning"
  ],
  "Pests & Wildlife": [
    "Pest control", "Termite control", "Mosquito control", "Bed bug removal",
    "Wildlife removal", "Bee removal", "Rodent control"
  ],
  "Water & Damage": [
    "Water damage restoration", "Mold remediation", "Fire damage restoration",
    "Sewage cleanup", "Well drilling", "Water heater installation", "Spray foam insulation"
  ],
  "Trades": [
    "HVAC repair", "AC repair", "Furnace repair", "Plumbing", "Electrician",
    "Garage door repair", "Locksmith", "Appliance repair", "Septic tank pumping",
    "Dumpster rental", "Portable toilet rental"
  ],
  "Specialty & Events": [
    "Pool cleaning", "Pool installation", "Bounce house rental", "Party rentals",
    "Event photography", "Wedding photography", "DJ services", "Limo service",
    "Moving company", "Piano moving", "Notary services", "Private investigator"
  ]
};

// Flatten for convenience.
const NICHE_LIST = Object.values(NICHE_DB).flat();

function randomNiche() {
  const categories = Object.keys(NICHE_DB);
  const cat = categories[Math.floor(Math.random() * categories.length)];
  const items = NICHE_DB[cat];
  const niche = items[Math.floor(Math.random() * items.length)];
  return { niche, category: cat };
}

// Expose to both module-style and plain-script consumers.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { NICHE_DB, NICHE_LIST, randomNiche };
}
