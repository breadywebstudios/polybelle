// Polybelle Event Halls & Studio — site configuration
window.PB_CONFIG = {
  // ===== UNDER CONSTRUCTION SWITCH (public website only; the admin site is not affected) =====
  // true  = visitors see the "coming soon" page instead of the website
  // false = the website is live
  // While it's on, you can still view the real site by opening it with ?preview at the end of the address
  // (e.g. https://polybelle.vercel.app/?preview). Use ?preview=off to see the coming-soon page again.
  underConstruction: false,
  underConstructionMessage: "Our new website is almost ready. In the meantime, we'd love to help you plan your celebration on WhatsApp.",

  siteUrl: "https://www.polybelle.me",          // used for short invoice links (www.polybelle.me/i/...)
  supabaseUrl: "https://ntohdxudxfggsmhxhvho.supabase.co",
  supabaseKey: "sb_publishable_81P5_TSD4SuHALFDM4Ao-w_W7C5UkuI",
  storageBucket: "polybelle",

  // Fallbacks (live values come from the admin Settings tab)
  bookingWhatsapp: "971528653208",            // where booking requests are sent (backup if Admin Settings can't load)
  whatsappIconNumber: "971564851757",        // TEMPORARY test: the small WhatsApp icon under the booking button sends the booking here
  bookingWhatsappChoices: [
    { number: "971528653208", label: "+971 52 865 3208" }
  ],
  displayPhones: "052 865 3208 | 054 557 9880", // shown on the site
  instagram: "polybelleevents",
  facebook: "https://www.facebook.com/profile.php?id=100089250728671",
  // Social links shown as icons in the top bar and footer. Leave a url empty ("") to hide it.
  socials: [
    { name: "Facebook", url: "https://www.facebook.com/profile.php?id=100089250728671" },
    { name: "Instagram", url: "https://www.instagram.com/polybelleevents" },
    { name: "TikTok", url: "" }
  ],

  // "Other venues": a card in the Halls section and a choice in the booking form for events at the
  // customer's own venue (hotel, villa, park, home, or another venue). It books packages/services, the customer types the location,
  // and its calendar shows sessions our team already has confirmed at other venues. show: false hides it.
  otherVenue: {
    show: true,
    name: "Other venues",
    tagline: "Hotel, villa, park, home or any venue",
    description: "We bring our packages, styling and team to your chosen hotel, villa, park, home or other venue in Abu Dhabi. Tell us where, then pick your packages and services.",
    image: "assets/parade-images/pic3.webp",
    imagePos: ""                     // framing, e.g. "50% 30%" (leave empty for centered)
  },

  branches: [
    {
      name: "Polybelle - Hall A & B",
      address: "603, 6th Floor, Tower B",
      landmark: "Metro Manila / Global Studio Building, behind City Season Hotel, Electra Street",
      mapUrl: "https://maps.app.goo.gl/iGwjTLTESVSD1wGN6"
    },
    {
      name: "Polybelle - Hall C",
      address: "1802, 18th Floor, C88 Commercial Tower A",
      landmark: "AST Trading / dnata Travel Building, Electra Street, behind City Season Hotel",
      mapUrl: "https://share.google/n6CTvTV2nUmjItbyQ"
    },
    {
      name: "Polybelle - Hall D",
      address: "Mezzanine 1, Building No. 156",
      landmark: "Phil Greenhouse Cosmetics Building, beside Best Chicken, opposite Al Wahda Mall",
      mapUrl: "https://g.co/kgs/73F8P3G"
    }
  ],

  sessions: [
    { id: "Morning", time: "9:00 AM – 1:00 PM" },
    { id: "Afternoon", time: "2:00 PM – 6:00 PM" },
    { id: "Evening", time: "7:00 PM – 11:00 PM" },
    { id: "Whole day", time: "9:00 AM – 11:00 PM" }
  ],

  eventTypes: ["Birthday", "Wedding", "Baby Shower", "Gender Reveal",
    "Debut", "Anniversary", "Corporate Event", "Seminar / Meeting", "Other"],

  // Packages and services customers can pick (with a hall, or on their own)
  addOns: ["Full Celebration Package", "Wedding Package", "Event Styling", "Catering", "Customized Cake", "Photo & Video",
    "Professional Host", "Photobooth", "Mascot Surprise", "Scent Station", "DIY Craft Station", "Souvenirs",
    "Face Painting", "Video / Audio Guestbook"],

  // Tabs in the booking form's package & service picker (same groups as the package poster)
  serviceCategories: ["Full Packages", "Wedding Packages", "Mascot Surprise", "Souvenirs & Stations", "Event Services"],

  galleryCategories: ["Birthday", "Wedding", "Baby Shower", "Gender Reveal", "Cake Smash", "Photobooth", "Corporate"],

  // Shown when a venue has no photo yet
  fallbackImages: [
    "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1478146896981-b80fe463b330?auto=format&fit=crop&w=1200&q=70"
  ],
  heroImage: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=2000&q=75"
};
