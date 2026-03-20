// =======================
// Global State
// =======================
let viewer;
let currentStyle = "cartoon";
let history = [];
let labelsVisible = false;
let currentMoleculeText = ""; // To pass to Gemini
let currentExt = "";
let hiddenResidues = new Set();

// =======================
// Init Viewer
// =======================
function initViewer() {
  viewer = $3Dmol.createViewer("viewer", {
    backgroundColor: "rgba(0,0,0,0)" // Transparent background to show glassmorphism
  });
  viewer.render();
}

// =======================
// Utility Functions
// =======================
function log(msg) {
  const box = document.querySelector(".console pre");
  if (!box) return;
  box.textContent += `\n> ${msg}`;
  box.parentNode.scrollTop = box.parentNode.scrollHeight;
}

function applyStyle(style) {
  history.push(currentStyle);
  currentStyle = style;

  viewer.removeAllSurfaces();
  viewer.setStyle({}, {});

  let styleObj = {};
  if (style === "cartoon") {
    styleObj = { cartoon: { color: "spectrum" } };
  } else if (style === "sticks") {
    styleObj = { stick: {} };
  } else if (style === "surface") {
    styleObj = { cartoon: { color: "spectrum" } };
  } else if (style === "ballstick") {
    styleObj = { stick: { radius: 0.15 }, sphere: { radius: 0.5 } };
  } else if (style === "spheres") {
    styleObj = { sphere: { color: "spectrum" } };
  } else if (style === "ribbon") {
    // Fallback to line trace if structural properties don't support thick ribbons
    styleObj = { line: { linewidth: 2 } };
  }

  // 1. Apply style to everything
  viewer.setStyle({}, styleObj);

  // 2. Hide hidden compounds
  hiddenResidues.forEach(resn => {
    viewer.setStyle({ resn: resn }, {});
  });

  // Apply surface if requested, 3Dmol will handle it generally ignoring hidden items if possible
  if (style === "surface") {
    viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.7, color: 'white' });
  }

  viewer.render();
}

// =======================
// Compounds Filtering
// =======================
function populateCompounds() {
  const atoms = viewer.getModel().selectedAtoms({});
  const resnSet = new Set();
  atoms.forEach(a => {
    if (a.resn) resnSet.add(a.resn);
  });

  const listDiv = document.getElementById("compoundsList");
  listDiv.innerHTML = "";

  if (resnSet.size === 0) {
    listDiv.innerHTML = '<span class="text-muted" style="font-size: 0.8rem; opacity: 0.6;">No distinct compounds found.</span>';
    return;
  }

  Array.from(resnSet).sort().forEach(resn => {
    const label = document.createElement("label");
    label.className = "compound-toggle";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !hiddenResidues.has(resn);

    cb.onchange = (e) => {
      if (e.target.checked) {
        hiddenResidues.delete(resn);
      } else {
        hiddenResidues.add(resn);
      }
      applyStyle(currentStyle);
    };

    label.appendChild(cb);
    let displayName = resn;
    if (resn === "HOH") displayName = "HOH (Water)";
    label.appendChild(document.createTextNode(` ${displayName}`));

    listDiv.appendChild(label);
  });
}

// =======================
// Toolbar Buttons
// =======================
document.getElementById("uploadBtn").onclick = () => {
  const input = document.createElement("input");
  input.type = "file";
  // Restrict uploads strictly to 3D molecule formats
  input.accept = ".pdb,.cif,.mol,.sdf,.xyz,.xyzrn,.pqr";

  input.onchange = e => {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = () => {
      viewer.clear();
      history = [];
      hiddenResidues.clear(); // reset filters

      currentExt = file.name.split(".").pop().toLowerCase();
      currentMoleculeText = reader.result;

      viewer.addModel(currentMoleculeText, currentExt);

      populateCompounds();

      applyStyle("cartoon");
      viewer.zoomTo();
      viewer.render();

      log(`Loaded: ${file.name}`);
      const placeholder = document.querySelector('.viewer-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      addSystemMessage(`Successfully loaded ${file.name}. Ask me what you'd like to know about it!`);
    };

    reader.readAsText(file);
  };

  input.click();
};

document.getElementById("viewerZoomIn").onclick = () => {
  viewer.zoom(1.2);
  viewer.render();
};
document.getElementById("viewerZoomOut").onclick = () => {
  viewer.zoom(0.8);
  viewer.render();
};
document.getElementById("viewerPanUp").onclick = () => {
  viewer.translate(0, -20);
  viewer.render();
};
document.getElementById("viewerPanDown").onclick = () => {
  viewer.translate(0, 20);
  viewer.render();
};
document.getElementById("viewerPanLeft").onclick = () => {
  viewer.translate(-20, 0);
  viewer.render();
};
document.getElementById("viewerPanRight").onclick = () => {
  viewer.translate(20, 0);
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
document.getElementById("ballStickBtn").onclick = () => applyStyle("ballstick");
document.getElementById("spheresBtn").onclick = () => applyStyle("spheres");
document.getElementById("ribbonBtn").onclick = () => applyStyle("ribbon");

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
    const action = e.currentTarget.title || e.currentTarget.innerText;

    if (action.includes("Center") || action === "A") {
      viewer.zoomTo();
      viewer.render();
      log("Action: center object");
    }

    if (action.includes("Show") || action === "S") {
      applyStyle(currentStyle);
      log(`Show: ${currentStyle}`);
    }

    if (action.includes("Hide") || action === "H") {
      history.push(currentStyle);
      viewer.setStyle({}, {});
      viewer.removeAllSurfaces();
      viewer.render();
      log("Hide representation");
    }

    if (action.includes("Labels") || action === "L") {
      labelsVisible = !labelsVisible;
      viewer.removeAllLabels();

      if (labelsVisible) {
        viewer.selectedAtoms({}).slice(0, 20).forEach(atom => {
          viewer.addLabel(
            `${atom.resn}${atom.resi}`,
            { position: atom, backgroundColor: "black", backgroundOpacity: 0.8 }
          );
        });
        log("Labels ON");
      } else {
        log("Labels OFF");
      }

      viewer.render();
    }

    if (action.includes("Chain") || action === "C") {
      history.push(currentStyle);
      viewer.setStyle({}, { cartoon: { color: "chain" } });
      viewer.render();
      log("Color by chain");
    }
  };
});

// =======================
// Gemini Chatbot RAG Logic
// =======================
const chatHistory = document.getElementById("chatHistory");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");

// HARDCODED FREE GEMINI API KEY for RAG System
// Replace this with your actual free Gemini API key
const GEMINI_API_KEY = "";

let activeGeminiModel = null; // Auto-detect model to prevent versioning errors

function addChatMessage(role, text) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `chat-msg ${role}-msg`;
  msgDiv.innerText = text;
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function addSystemMessage(text) {
  addChatMessage("system", text);
}

async function sendMessageToGemini(prompt) {
  if (GEMINI_API_KEY === "YOUR_FREE_API_KEY_HERE") {
    addSystemMessage("NOTICE: Please insert your free Gemini API key into script.js (GEMINI_API_KEY) to activate the RAG AI!");
    return;
  }

  addChatMessage("user", prompt);
  chatInput.value = "";

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "chat-msg bot-msg";
  loadingDiv.innerText = "...";
  chatHistory.appendChild(loadingDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  // Auto-Detect correct model name to prevent 'not found' version errors
  if (!activeGeminiModel) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
      const data = await res.json();
      if(data.error) throw new Error(data.error.message);
      
      const textModels = data.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"));
      if(textModels.length > 0) {
        let preferred = textModels.find(m => m.name.includes("gemini-1.5-flash"));
        if(!preferred) preferred = textModels.find(m => m.name.includes("gemini-1.5-pro"));
        if(!preferred) preferred = textModels.find(m => m.name.includes("gemini-pro"));
        activeGeminiModel = preferred ? preferred.name : textModels[0].name;
      } else {
        throw new Error("No supported generation models found on this key.");
      }
    } catch(e) {
      chatHistory.removeChild(loadingDiv);
      addSystemMessage(`API Sync Error: ${e.message}`);
      return;
    }
  }

  // Strict RAG system prompt
  const systemPrompt = `You are the Biotech RAG AI for totallyNotPymol. 
STRICT RULE: Only answer queries related to biotechnology, chemistry, the 3D structure of the currently uploaded molecule, or how to use this app.
If a user asks anything else (e.g., weather, chit-chat, programming, off-topic general knowledge), REJECT the query with: "I am a Biotech RAG assistant restricted to molecule and biotech queries only."
Molecule Data Context (Format: ${currentExt}):
${currentMoleculeText ? currentMoleculeText.substring(0, 3000) + "... (truncated)" : "No molecule uploaded yet."}
`;

  try {
    const modelUrlName = activeGeminiModel.startsWith("models/") ? activeGeminiModel : `models/${activeGeminiModel}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelUrlName}:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    chatHistory.removeChild(loadingDiv);

    if (data.error) {
      addSystemMessage(`Error: ${data.error.message}`);
    } else if (data.candidates && data.candidates[0].content.parts[0].text) {
      addChatMessage("bot", data.candidates[0].content.parts[0].text);
    } else {
      addSystemMessage("Received an empty response.");
    }
  } catch (err) {
    chatHistory.removeChild(loadingDiv);
    addSystemMessage(`Connection error: ${err.message}`);
  }
}

sendChatBtn.onclick = () => {
  const text = chatInput.value.trim();
  if (text) sendMessageToGemini(text);
};

chatInput.onkeydown = (e) => {
  if (e.key === "Enter") {
    const text = chatInput.value.trim();
    if (text) sendMessageToGemini(text);
  }
};

// =======================
// Help Modal Logic
// =======================
const helpModal = document.getElementById("helpModal");
document.getElementById("helpMenuBtn").onclick = () => {
  helpModal.classList.remove("hidden");
};
document.getElementById("closeHelpBtn").onclick = () => {
  helpModal.classList.add("hidden");
};
helpModal.onclick = (e) => {
  if (e.target === helpModal) helpModal.classList.add("hidden");
};

// =======================
// Theme Toggle Logic
// =======================
const themeToggleBtn = document.getElementById("themeToggleBtn");
if (themeToggleBtn) {
  themeToggleBtn.onclick = () => {
    document.body.classList.toggle("light-theme");
    const icon = themeToggleBtn.querySelector("span");
    if (document.body.classList.contains("light-theme")) {
      icon.innerText = "dark_mode";
      viewer.setBackgroundColor("rgba(255,255,255,0.1)");
    } else {
      icon.innerText = "light_mode";
      viewer.setBackgroundColor("rgba(0,0,0,0)");
    }
    viewer.render();
  };
}

// =======================
// Layout Toggles
// =======================
const toggleChatBtn = document.getElementById("toggleChatBtn");
if (toggleChatBtn) {
  toggleChatBtn.onclick = () => {
    document.querySelector('.chat-side-panel').classList.toggle('hide-panel');
  };
}

// =======================
initViewer();
