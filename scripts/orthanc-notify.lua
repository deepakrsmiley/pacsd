-- Notify PACSD as soon as Orthanc stores an instance (C-STORE or Explorer upload).
-- Wire this file into Orthanc with LuaScripts in orthanc.json, then restart Orthanc.
-- The token must match ORTHANC_WEBHOOK_TOKEN on both the local API and Render.
-- Local keeps the workstation site instant. Render is the public site.

local targets = {
  { url = "http://127.0.0.1:4000", token = "pacsd-orthanc-notify-2026" },
  { url = "https://pacsd.onrender.com", token = "pacsd-orthanc-notify-2026" }
}

local function notify(path, body)
  for _, target in ipairs(targets) do
    local headers = {
      ["Content-Type"] = "application/json",
      ["x-pacsd-token"] = target.token
    }
    local ok, err = pcall(function()
      HttpPost(target.url .. path, body, headers)
    end)
    if not ok then
      print("PACSD notify failed for " .. target.url .. path .. ": " .. tostring(err))
    end
  end
end

function OnStoredInstance(instanceId, tags, metadata)
  notify("/api/orthanc/notify", '{"instance":"' .. instanceId .. '"}')
end

function OnStableStudy(studyId, tags, metadata)
  notify("/api/orthanc/stable", '{"study":"' .. studyId .. '"}')
end
