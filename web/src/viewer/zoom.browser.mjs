import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const origin = process.env.VIEWER_TEST_URL ?? "http://localhost:5173";
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const [overview, fine] = (await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1728;
    canvas.height = 1856;
    const context = canvas.getContext("2d");
    context.fillStyle = "#b4b4b4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const overview = canvas.toDataURL().split(",")[1];
    canvas.width = canvas.height = 512;
    context.fillStyle = "rgba(40, 40, 40, 0.5)";
    for (let x = 0; x < canvas.width; x += 2) context.fillRect(x, 0, 1, canvas.height);
    return [overview, canvas.toDataURL().split(",")[1]];
  })).map((png) => Buffer.from(png, "base64"));
  const properties = [
    "creator_did = ivo://IPAC/P/SPHEREx/DR1/cube",
    "hips_frame = equatorial",
    "hips_order = 5",
    "hips_order_min = 0",
    "hips_tile_width = 512",
    "hips_tile_format = png",
    "moc_sky_fraction = 1",
    "dataproduct_type = cube",
    "hips_cube_depth = 102",
    "hips_cube_firstframe = 1",
    "em_min = 7.43e-7",
    "em_max = 5.009e-6",
  ].join("\n");
  let overviewRequests = 0;
  let releaseFine;
  const holdFine = new Promise((resolve) => { releaseFine = resolve; });
  await page.route("https://**/*", async (route) => {
    const { pathname } = new URL(route.request().url());
    const headers = { "access-control-allow-origin": "*" };
    if (pathname.endsWith("/spherex_allsky_cube/properties")) {
      return route.fulfill({ headers, contentType: "text/plain", body: properties });
    }
    if (pathname.endsWith("/spherex_allsky_cube/Norder3/Allsky_1.png")) {
      overviewRequests++;
      return route.fulfill({ headers, contentType: "image/png", body: overview });
    }
    if (/spherex_allsky_cube\/Norder5\/Dir\d+\/Npix\d+_1\.png$/.test(pathname)) {
      await holdFine;
      return route.fulfill({ headers, contentType: "image/png", body: fine });
    }
    return route.fulfill({ headers, status: 404 });
  });

  async function sampleSky(size = 1) {
    const screenshot = await page.screenshot({ clip: {
      x: 492 - Math.floor(size / 2), y: 320 - Math.floor(size / 2), width: size, height: size,
    } });
    return page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = image.width;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, image.width, image.height).data;
      return Array.from(new Set(rgba.filter((_, index) => index % 4 === 0)));
    }, `data:image/png;base64,${screenshot.toString("base64")}`);
  }

  await page.goto(origin);
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  const deadline = Date.now() + 15_000;
  let [pixel] = await sampleSky();
  while (Math.abs(pixel - 180) > 5 && Date.now() < deadline) [pixel] = await sampleSky();
  assert.ok(Math.abs(pixel - 180) <= 5, `Overview failed to load at globe zoom (pixel ${pixel})`);

  const fineRequested = page.waitForRequest((request) => /Norder5\/Dir\d+\/Npix\d+_1\.png$/.test(request.url()));
  for (let step = 1; step <= 11; step++) {
    await zoomIn.click();
    const [pixel] = await sampleSky();
    assert.ok(Math.abs(pixel - 180) <= 5, `Sky blanked during zoom step ${step} (pixel ${pixel})`);
  }

  assert.match(await page.locator(".sky-readout").innerText(), /5\.27′/);
  await fineRequested;
  assert.equal(overviewRequests, 1, "Zoom should reuse the downloaded overview");

  releaseFine();
  // Transparent stripes reveal the bright overview. Covered stripes must show
  // the dark detail without brightening from the overview behind them.
  const fillDeadline = Date.now() + 15_000;
  let colors = await sampleSky(112);
  const showsFine = (values) => values.some((value) => value >= 10 && value <= 45);
  while (!showsFine(colors) && Date.now() < fillDeadline) colors = await sampleSky(112);
  assert.ok(showsFine(colors), `Fine tiles blended with the overview (${colors})`);
  assert.ok(colors.some((value) => Math.abs(value - 180) <= 5), "Transparent fine pixels should reveal the overview");
  console.log("Overview stayed visible during zoom. Covered fine pixels replaced it after loading.");
} finally {
  await browser.close();
}
