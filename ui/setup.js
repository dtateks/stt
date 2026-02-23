const saveBtn = document.getElementById("save-btn");
const xaiInput = document.getElementById("xai-key");
const sonioxInput = document.getElementById("soniox-key");
const errorEl = document.getElementById("setup-error");

saveBtn.addEventListener("click", async () => {
  const xaiKey = xaiInput.value.trim();
  const sonioxKey = sonioxInput.value.trim();

  if (!xaiKey || !sonioxKey) {
    errorEl.textContent = "Both API keys are required.";
    errorEl.style.display = "block";
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  errorEl.style.display = "none";

  try {
    await window.voiceEverywhere.saveCredentials(xaiKey, sonioxKey);
  } catch (err) {
    errorEl.textContent = "Failed to save: " + err.message;
    errorEl.style.display = "block";
    saveBtn.disabled = false;
    saveBtn.textContent = "Save & Start";
  }
});
