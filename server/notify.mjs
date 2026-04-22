// Cross-platform desktop notifications. Fire-and-forget — never throws,
// never blocks the caller, never awaits the child process.

import { spawn } from "node:child_process";
import { platform } from "node:os";

export function notifyDesktop(title, body) {
  const plat = platform();
  const opts = { detached: true, stdio: "ignore" };
  try {
    if (plat === "darwin") {
      // osascript is always present on macOS. Escape double quotes inside the
      // applescript literal by replacing with smart quotes — simpler than
      // proper shell escaping and good enough for notification text.
      const safeTitle = String(title).replace(/"/g, "”");
      const safeBody = String(body).replace(/"/g, "”");
      const script = `display notification "${safeBody}" with title "${safeTitle}" sound name "Basso"`;
      const child = spawn("osascript", ["-e", script], opts);
      child.unref?.();
    } else if (plat === "linux") {
      const child = spawn("notify-send", ["-u", "critical", String(title), String(body)], opts);
      child.unref?.();
    } else if (plat === "win32") {
      // PowerShell toast — works on Windows 10+.
      const ps = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("${String(title).replace(/"/g, "'")}")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode("${String(body).replace(/"/g, "'")}")) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Decoy Tripwire").Show($toast)
      `;
      const child = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], opts);
      child.unref?.();
    }
    // Other platforms: silently skip. Proxy still works.
  } catch {
    // Never let notification failure affect proxy behavior.
  }
}

// Tripwire-specific helper — keeps the proxy call site readable.
export function notifyTripwire({ tool, agent, ttlMs, scope }) {
  const title = scope === "all" ? "Decoy: all agents paused" : "Decoy: agent paused";
  const minutes = ttlMs == null ? null : Math.max(1, Math.round(ttlMs / 60000));
  const when = minutes == null ? "until manually resumed" : `for ${minutes} min`;
  const who = agent || "unknown agent";
  const body = `Tripwire ${tool} hit — ${who} paused ${when}.`;
  notifyDesktop(title, body);
}
