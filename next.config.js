/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces .next/standalone with a self-contained server.js,
  // so the Docker image doesn't need the full node_modules.
  output: "standalone",

  async redirects() {
    return [
      {
        // Lessons used to live under /curso/ — Spanish for "course", a
        // leftover from the original scaffolding. Anything already
        // bookmarked or linked keeps working.
        source: "/curso/:slug",
        destination: "/course/:slug",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
