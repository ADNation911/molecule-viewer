// =======================
// Global State
// =======================
let viewer;
let currentStyle = "cartoon";
let history = [];
let labelsVisible = false;

// =======================
// Init Viewer
// =======================
function initViewer() {
  viewer = $3Dmol.createViewer("viewer", {
    backgroundColor: "black"
  });
  viewer.render();
}

// =======================
// Utility Functions
// =======================
function log(msg) {
  const box = document.querySelector(".console pre");
  box.textContent += `\n> ${msg}`;
  box.scrollTop = box.scrollHeight;
}

function applyStyle(style) {
  history.push(currentStyle);
  currentStyle = style;

  viewer.removeAllSurfaces();
  viewer.setStyle({}, {});

  if (style === "cartoon") {
    viewer.setStyle({}, { cartoon: { color: "spectrum" } });
  }
  if (style === "sticks") {
    viewer.setStyle({}, { stick: {} });
  }
  if (style === "surface") {
    viewer.setStyle({}, { cartoon: { color: "spectrum" } });
    viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.7 });
  }

  viewer.render();
}

// =======================
// Toolbar Buttons
// =======================
document.getElementById("uploadBtn").onclick = () => {
  const input = document.createElement("input");
  input.type = "file";

  input.onchange = e => {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = () => {
      viewer.clear();
      history = [];

      const ext = file.name.split(".").pop().toLowerCase();
      viewer.addModel(reader.result, ext);

      applyStyle("cartoon");
      viewer.zoomTo();
      viewer.render();

      log(`Loaded: ${file.name}`);
    };

    reader.readAsText(file);
  };

  input.click();
};

document.getElementById("zoomBtn").onclick = () => {
  viewer.zoom(1.2);
  viewer.render();
};

document.getElementById("rotateBtn").onclick = () => {
  viewer.rotate(90, "y");
  viewer.render();
};

document.getElementById("panBtn").onclick = () => {
  viewer.translate(20, 0);
  viewer.render();
};

document.getElementById("cartoonBtn").onclick = () => applyStyle("cartoon");
document.getElementById("sticksBtn").onclick = () => applyStyle("sticks");
document.getElementById("surfaceBtn").onclick = () => applyStyle("surface");

document.getElementById("redoBtn").onclick = () => {
  if (history.length === 0) return;
  const prev = history.pop();
  applyStyle(prev);
  log(`Redo: ${prev}`);
};

document.getElementById("renderBtn").onclick = () => viewer.render();

// =======================
// Object Panel Buttons
// =======================
document.querySelectorAll(".controls button").forEach(btn => {
  btn.onclick = e => {
    const action = e.target.innerText;

    if (action === "A") {
      viewer.zoomTo();
      viewer.render();
      log("Action: center object");
    }

    if (action === "S") {
      applyStyle(currentStyle);
      log(`Show: ${currentStyle}`);
    }

    if (action === "H") {
      history.push(currentStyle);
      viewer.setStyle({}, {});
      viewer.removeAllSurfaces();
      viewer.render();
      log("Hide representation");
    }

    if (action === "L") {
      labelsVisible = !labelsVisible;
      viewer.removeAllLabels();

      if (labelsVisible) {
        viewer.selectedAtoms({}).slice(0, 20).forEach(atom => {
          viewer.addLabel(
            `${atom.resn}${atom.resi}`,
            { position: atom, backgroundColor: "black" }
          );
        });
        log("Labels ON");
      } else {
        log("Labels OFF");
      }

      viewer.render();
    }

    if (action === "C") {
      history.push(currentStyle);
      viewer.setStyle({}, { cartoon: { color: "chain" } });
      viewer.render();
      log("Color by chain");
    }
  };
});

// =======================
initViewer();

const supabase = supabase.createClient(
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY"
);

// Login
document.getElementById("loginBtn").onclick = async () => {
  const email = prompt("Enter email");
  await supabase.auth.signInWithOtp({ email });
  alert("Check your email for login link");
};

// Logout
document.getElementById("logoutBtn").onclick = async () => {
  await supabase.auth.signOut();
  location.reload();
};

// Session handling
supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    document.getElementById("authButtons").style.display = "none";
    document.getElementById("userSection").style.display = "block";
    document.getElementById("userEmail").innerText = session.user.email;
  }
});