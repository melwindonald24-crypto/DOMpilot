const goalInput = document.getElementById("goal");
const startButton = document.getElementById("startTask");
const stopButton = document.getElementById("stopTask");
const statusBox = document.getElementById("status");

function setStatus(message) {
  statusBox.textContent = message;
}

startButton.addEventListener("click", async () => {
  const goal = goalInput.value.trim() || "Fill the active form";
  setStatus("Starting task...");
  const response = await chrome.runtime.sendMessage({ action: "startTask", goal, maxIterations: 10 });
  setStatus(response?.ok ? "Task started" : response?.error || "Failed to start task");
});

stopButton.addEventListener("click", async () => {
  setStatus("Stopping task...");
  const response = await chrome.runtime.sendMessage({ action: "stopTask" });
  setStatus(response?.ok ? "Task stopped" : response?.error || "Failed to stop task");
});

setInterval(async () => {
  const response = await chrome.runtime.sendMessage({ action: "getTaskState" }).catch(() => null);
  const taskState = response?.taskState;
  if (!taskState) return;
  setStatus(`${taskState.status} — ${taskState.goal || "Task"}`);
}, 1000);
