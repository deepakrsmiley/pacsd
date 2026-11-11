import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";
import { Alert, Badge, DataGrid, Field, Metrics, Page, Panel, fieldClass } from "../ui.jsx";

const ROLE_LABEL = {
  system_admin: "System administrator",
  facility_admin: "Facility administrator",
  radiologist: "Radiologist",
  technologist: "Technologist",
  referring_physician: "Referring physician",
};

export default function Settings() {
  const { user, applyUser } = useAuth();
  const { facilityId } = useFacility();
  const canManage = user.role === "system_admin" || user.role === "facility_admin";
  const [status, setStatus] = useState(null);
  const [facilities, setFacilities] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [edit, setEdit] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(canManage);
  const toasts = useToasts();
  const [facilityForm, setFacilityForm] = useState({ name: "", code: "" });
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "technologist", facilityIds: [] });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", password: "", confirm: "" });

  function refresh() {
    setDirectoryLoading(true);
    Promise.all([
      api("/api/system/status"),
      api("/api/facilities"),
      api("/api/users"),
    ]).then(([statusData, facilityData, userData]) => {
      setStatus(statusData);
      setFacilities(facilityData.facilities);
      setUsers(userData.users);
    }).catch((err) => toasts.error(err.message))
      .finally(() => setDirectoryLoading(false));
  }

  useEffect(() => {
    if (canManage) refresh();
  }, [canManage, facilityId]);

  async function addFacility(event) {
    event.preventDefault();
    try {
      await api("/api/facilities", { method: "POST", body: facilityForm });
      setFacilityForm({ name: "", code: "" });
      toasts.success("Facility added.");
      refresh();
    } catch (err) {
      toasts.error(err.message);
    }
  }

  async function addUser(event) {
    event.preventDefault();
    try {
      await api("/api/users", {
        method: "POST",
        body: { ...userForm, facilityIds: userForm.facilityIds.length ? userForm.facilityIds : [facilities[0]?._id].filter(Boolean) },
      });
      setUserForm({ name: "", email: "", password: "", role: "technologist", facilityIds: [] });
      toasts.success("User created. They can sign in with the password you set.");
      refresh();
    } catch (err) {
      toasts.error(err.message);
    }
  }

  function selectUser(person) {
    setSelectedId(person._id);
    setEdit({
      name: person.name,
      role: person.role,
      active: person.active !== false,
      facilityIds: (person.facilityIds || []).map(String),
    });
  }

  function toggleFacility(id) {
    setEdit((current) => {
      const facilityIds = current.facilityIds.includes(id)
        ? current.facilityIds.filter((item) => item !== id)
        : [...current.facilityIds, id];
      return { ...current, facilityIds };
    });
  }

  async function saveUser(event) {
    event.preventDefault();
    try {
      await api(`/api/users/${selectedId}`, { method: "PATCH", body: edit });
      toasts.success("Account updated.");
      refresh();
    } catch (err) {
      toasts.error(err.message);
    }
  }

  async function resetPassword() {
    try {
      const data = await api(`/api/users/${selectedId}/reset-password`, { method: "POST" });
      toasts.success(`Temporary password: ${data.temporaryPassword}. It must be changed at the next sign-in.`);
      refresh();
    } catch (err) {
      toasts.error(err.message);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (passwordForm.password !== passwordForm.confirm) {
      toasts.error("The new passwords do not match.");
      return;
    }
    try {
      const data = await api("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword: passwordForm.currentPassword, password: passwordForm.password },
      });
      applyUser(data.user);
      setPasswordForm({ currentPassword: "", password: "", confirm: "" });
      toasts.success("Password changed.");
    } catch (err) {
      toasts.error(err.message);
    }
  }

  const configured = status ? ["smtp", "whatsapp", "ai", "orthanc", "speech"].filter((key) => status[key]).length : 0;
  const roles = ["facility_admin", "radiologist", "technologist", "referring_physician", ...(user.role === "system_admin" ? ["system_admin"] : [])];

  return (
    <Page kicker="Administration" title="Users and roles" summary="Accounts and facilities for this deployment. A new user receives the password entered here. There is no separate invitation email.">
      {user.mustChangePassword && <Alert tone="warn">Change your password before continuing.</Alert>}
      <Panel title="Change your password" className="mb-6">
        <form onSubmit={changePassword} className="grid gap-3 p-3 sm:grid-cols-3">
          <Field label="Current password"><input required type="password" className={fieldClass} value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></Field>
          <Field label="New password"><input required type="password" minLength={10} className={fieldClass} value={passwordForm.password} onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })} /></Field>
          <Field label="Confirm password"><input required type="password" minLength={10} className={fieldClass} value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} /></Field>
          <div className="sm:col-span-3"><button className="h-9 bg-[#5b21b6] px-4 text-sm text-white">Update password</button></div>
        </form>
      </Panel>
      {canManage && <Metrics items={[
        { label: "Users", value: users.length, detail: "Accounts you can see" },
        { label: "Facilities", value: facilities.length, detail: "Sites in this deployment" },
        { label: "Active", value: users.filter((person) => person.active !== false).length, detail: "Sign-in enabled" },
        { label: "Integrations on", value: configured, detail: "Of email, WhatsApp, assist, Orthanc, speech" },
      ]} />}
      {canManage && <div className="mb-4 grid gap-3 xl:grid-cols-2">
        <Panel title="Facilities">
          <div className="p-3">
            <DataGrid
              columns={[
                { key: "name", label: "Facility" },
                { key: "code", label: "Code" },
              ]}
              rows={facilities}
              rowKey={(facility) => facility._id}
              empty="No facilities are visible."
            />
            {user.role === "system_admin" && (
              <form onSubmit={addFacility} className="mt-3 grid items-end gap-2 md:grid-cols-[1fr_140px_auto]">
                <Field label="Facility name"><input required className={fieldClass} value={facilityForm.name} onChange={(event) => setFacilityForm({ ...facilityForm, name: event.target.value })} /></Field>
                <Field label="Facility code"><input required className={fieldClass} value={facilityForm.code} onChange={(event) => setFacilityForm({ ...facilityForm, code: event.target.value })} /></Field>
                <button className="h-9 bg-[#5b21b6] px-3 text-sm text-white">Add facility</button>
              </form>
            )}
          </div>
        </Panel>
        <Panel title="Create an account">
          <form onSubmit={addUser} className="grid gap-3 p-3 sm:grid-cols-2">
            <Field label="Name"><input required className={fieldClass} value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></Field>
            <Field label="Email"><input required type="email" className={fieldClass} value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></Field>
            <Field label="Password"><input required type="password" minLength={10} className={fieldClass} value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /></Field>
            <Field label="Role">
              <select className={fieldClass} value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
                {roles.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2"><button className="h-9 bg-[#5b21b6] px-4 text-sm text-white">Create user</button></div>
          </form>
        </Panel>
      </div>}
      {canManage && (
        <Panel title="Directory">
          <div className="grid gap-3 p-3 xl:grid-cols-[1fr_320px]">
            <DataGrid
              columns={[
                { key: "name", label: "Name" },
                { key: "email", label: "Email" },
                { key: "role", label: "Role", render: (person) => <Badge tone="info">{ROLE_LABEL[person.role] || person.role}</Badge> },
                { key: "active", label: "Account", render: (person) => <Badge tone={person.active === false ? "bad" : "good"}>{person.active === false ? "Inactive" : person.mustChangePassword ? "Password reset" : "Active"}</Badge> },
              ]}
              rows={users}
              loading={directoryLoading}
              rowKey={(person) => person._id}
              selectedKey={selectedId}
              onSelect={selectUser}
              empty="No users are visible."
            />
            {edit ? (
              <form onSubmit={saveUser} className="grid content-start gap-3 border border-white/10 p-3">
                <Field label="Name"><input required className={fieldClass} value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></Field>
                <Field label="Role">
                  <select className={fieldClass} value={edit.role} onChange={(event) => setEdit({ ...edit, role: event.target.value })}>
                    {roles.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                  </select>
                </Field>
                <fieldset className="grid gap-1 text-sm text-zinc-200">
                  <legend className="text-xs uppercase tracking-wide text-zinc-300">Facilities</legend>
                  {facilities.map((facility) => (
                    <label key={facility._id} className="flex items-center gap-2">
                      <input type="checkbox" checked={edit.facilityIds.includes(String(facility._id))} onChange={() => toggleFacility(String(facility._id))} />
                      {facility.name}
                    </label>
                  ))}
                </fieldset>
                <label className="flex items-center gap-2 text-sm text-zinc-200">
                  <input type="checkbox" checked={edit.active} onChange={(event) => setEdit({ ...edit, active: event.target.checked })} />
                  Active
                </label>
                <button className="h-9 bg-[#5b21b6] px-4 text-sm text-white">Save account</button>
                <button type="button" className="h-9 border border-white/15 px-4 text-sm text-zinc-100" onClick={resetPassword}>Reset password</button>
              </form>
            ) : (
              <p className="border border-dashed border-white/15 px-3 py-6 text-sm text-zinc-300">Select an account to edit it or issue a temporary password.</p>
            )}
          </div>
        </Panel>
      )}
    </Page>
  );
}
