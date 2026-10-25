// Polybelle Event Halls & Studio — site configuration
window.PB_CONFIG = {
  supabaseUrl: "https://ntohdxudxfggsmhxhvho.supabase.co",
  supabaseKey: "sb_publishable_81P5_TSD4SuHALFDM4Ao-w_W7C5UkuI",
  storageBucket: "polybelle",

  // Fallbacks (live values come from the admin Settings tab)
  bookingWhatsapp: "971564851757",            // where booking requests are sent
  displayPhones: "052 865 3208 | 054 557 9880", // shown on the site
  instagram: "polybelleevents",
  facebook: "https://www.facebook.com/profile.php?id=100089250728671",
  // Social links shown as icons in the top bar and footer. Leave a url empty ("") to hide it.
  socials: [
    { name: "Facebook", url: "https://www.facebook.com/profile.php?id=100089250728671" },
    { name: "Instagram", url: "https://www.instagram.com/polybelleevents" },
    { name: "TikTok", url: "" }
  ],

  branches: [
    { name: "Electra", address: "1802, C88, Tower A", landmark: "Back side of City Seasons Hotel" },
    { name: "Al Falah", address: "703, Bldg No. 1", landmark: "Aster Pharmacy Bldg, near Al Falah Plaza" },
    { name: "Al Wahda", address: "Mezzanine 1, Bldg No. 156", landmark: "Phil Greenhouse Cosmetics Bldg, opp. Al Wahda Mall" }
  ],

  sessions: [
    { id: "Morning", time: "9:00 AM – 1:00 PM" },
    { id: "Afternoon", time: "2:00 PM – 6:00 PM" },
    { id: "Evening", time: "7:00 PM – 11:00 PM" },
    { id: "Whole day", time: "9:00 AM – 11:00 PM" }
  ],

  eventTypes: ["Birthday", "Wedding", "Baby Shower", "Gender Reveal", "Christening / Dedication",
    "Debut", "Anniversary", "Corporate Event", "Seminar / Meeting", "Other"],

  // Packages and services customers can pick (with a hall, or on their own)
  addOns: ["Full Celebration Package", "Wedding Package", "Event Styling", "Catering", "Customized Cake", "Photo & Video",
    "Professional Host", "Photobooth", "Mascot Surprise", "Scent Station", "DIY Craft Station", "Souvenirs",
    "Face Painting", "Video / Audio Guestbook"],

  galleryCategories: ["Birthday", "Wedding", "Baby Shower", "Christening", "Gender Reveal", "Cake Smash", "Photobooth", "Corporate"],

  // Shown when a venue has no photo yet
  fallbackImages: [
    "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1478146896981-b80fe463b330?auto=format&fit=crop&w=1200&q=70"
  ],
  heroImage: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=2000&q=75"
};
