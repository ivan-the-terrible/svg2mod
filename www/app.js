let pyodide;
let setupComplete = false;

async function setup() {
  const logElement = document.getElementById("outputLog");

  // Helper to append text to the log element
  const addToLog = text => {
    logElement.innerText += text + "\n";
    // Optional: Auto-scroll to the bottom
    logElement.scrollTop = logElement.scrollHeight;
  };

  // Initialize Pyodide with stdout/stderr redirection
  pyodide = await loadPyodide({
    stdout: text => {
      console.log(text);
      addToLog(text);
    },
    stderr: text => {
      console.error(text);
      addToLog(`[ERROR] ${text}`);
    },
  });
  // Load micropip to install the svg2mod package
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");

  // Install svg2mod and its dependencies
  await micropip.install("svg2mod");

  document.getElementById("status").innerText = "Status: Ready";

  const fileInput = document.getElementById("svgInput");
  if (fileInput.files.length !== 0) {
    setupComplete = true;
    document.getElementById("convertBtn").disabled = false;
  }
}

setup();

document.getElementById("svgInput").onchange = event => {
  if (event.target.files.length > 0) {
    setupComplete = true;
    document.getElementById("convertBtn").disabled = false;
  }
};

document.getElementById("convertBtn").onclick = async () => {
  const fileInput = document.getElementById("svgInput");
  if (fileInput.files.length === 0) return;

  if (!setupComplete) {
    status.innerText = "Status: Setup not complete.";
    return;
  }

  const file = fileInput.files[0];
  const svgText = await file.text();
  const status = document.getElementById("status");

  status.innerText = "Status: Converting...";

  // Clear previous error messages
  const errorOutput = document.getElementById("errorOutput");
  errorOutput.innerText = "";
  const errorDiv = document.getElementById("errorDiv");
  errorDiv.hidden = true;

  // Clear previous log output
  document.getElementById("outputLog").innerText = "";

  // Gather optional parameters (if any)
  const outputModuleName = document.getElementById("output").value || "svg2mod";
  const moduleValue = document.getElementById("moduleValue").value || "G***";
  const scale = parseFloat(document.getElementById("scale").value) || 1.0;
  const precision =
    parseFloat(document.getElementById("precision").value) || 5.0;
  const dpi = parseInt(document.getElementById("dpi").value) || 96;
  const centered = document.getElementById("center").checked;
  const excludeHidden = document.getElementById("excludeHidden").checked;
  const convertPads = document.getElementById("convertPads").checked;
  const forceLayer = document.getElementById("forceLayer").value || null;

  try {
    // 1. Write the SVG content to Pyodide's virtual file system
    pyodide.FS.writeFile("input.svg", svgText);

    // 2. Expose JS variables to Python globals
    // This makes these variables accessible by name in your Python script
    pyodide.globals.set("outputModuleName", outputModuleName);
    pyodide.globals.set("moduleValue", moduleValue);
    pyodide.globals.set("scale", scale);
    pyodide.globals.set("precision", precision);
    pyodide.globals.set("dpi", dpi);
    pyodide.globals.set("centered", centered);
    pyodide.globals.set("excludeHidden", excludeHidden);
    pyodide.globals.set("convertPads", convertPads);
    pyodide.globals.set("forceLayer", forceLayer);

    // 2. Run the svg2mod conversion logic via Python
    // We use the library interface of svg2mod rather than the CLI
    await pyodide.runPythonAsync(`
            from svg2mod.svg.svg import Text
            from svg2mod.exporter import Svg2ModExportLatest, Svg2ModImport

            # FIX: The library doesn't know about Emscripten font paths.
            # We tell it to use the same (empty) list as Windows/Linux
            # so it doesn't throw a KeyError.
            if 'Emscripten' not in Text._os_font_paths:
                Text._os_font_paths['Emscripten'] = []

            # Mirroring the logic in cli.py:

            # 1. Replicating the 'imported' logic
            # This parses the SVG file first
            imported = Svg2ModImport(
                "input.svg",
                module_name=outputModuleName,
                module_value=moduleValue,
                ignore_hidden=excludeHidden,
                force_layer=forceLayer
            )

            # 2. Instantiate Svg2Mod with the parameters cli.py usually parses
            exported = Svg2ModExportLatest(
                imported,
                outputModuleName + ".kicad_mod",
                centered,
                scale,
                precision,
                dpi = dpi,
                pads = convertPads
            )

            # 2. The cli.py calls .write(), which triggers the internal parser
            # and writes the KiCad formatted strings to the output file.
            exported.write()
        `);

    // 3. Read the generated .mod file back into JavaScript
    const modData = pyodide.FS.readFile(outputModuleName + ".kicad_mod");

    // 4. Trigger the download
    downloadBlob(modData, file.name.replace(".svg", ".kicad_mod"));
    status.innerText = "Status: Done!";
  } catch (err) {
    console.error(err);
    status.innerText = "Status: Error during conversion.";
    errorOutput.innerText = err.toString();
    errorDiv.hidden = false;
  }
};

function downloadBlob(data, fileName) {
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
