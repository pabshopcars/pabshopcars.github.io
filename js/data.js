// Business details, and where the cars come from: the NEW PAB SHOP Supabase project (set up
// 2026-09-15 on the friend's account). pabshop.com itself still reads the old project until it is
// switched over, so this mockup shows only cars imported into the new one — nothing stale.
// The key is that project's public "anon" key; row-level security decides what it may do, and
// this site only reads.
window.PAB = {
  business: {
    name: "PAB SHOP",
    phone: "+15165657312",
    phoneLabel: "(516) 565-7312",
    phone2: "+15857347880",
    phone2Label: "(585) 734-7880",
    email: "pabshopcars@gmail.com"
  },
  supabase: {
    url: "https://ygkolngvzroudjrinmqf.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlna29sbmd2enJvdWRqcmlubXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MTI2ODYsImV4cCI6MjEwNTA4ODY4Nn0.6wK0-rgvPJilRvbXPIpSVPkgcR-S-RN7oXWDeoMz4sU"
  },
  // Facebook Marketplace listing per car, by the car's id in the cars table:
  //   "<car id>": "<Marketplace item id>"   ->  facebook.com/marketplace/item/<item id>/
  // A car without an entry shows no Marketplace button.
  fbListings: {}
};
