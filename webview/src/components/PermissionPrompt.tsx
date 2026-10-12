import React from "react";
import type { PermissionDecision, UiPermission } from "../../../shared/protocol.js";

type Props = {
  permissions: UiPermission[];
  onReply: (requestID: string, decision: PermissionDecision) => void;
};

export function PermissionPrompt({ permissions, onReply }: Props): React.ReactElement | null {
  if (permissions.length === 0) return null;

  return (
    <div className="perm">
      {permissions.map((permission) => (
        <div className="perm__card" key={permission.id}>
          <div className="perm__head">
            <span className="perm__icon">⚠</span>
            <span className="perm__title">
              Permission required{permission.tool ? ` · ${permission.tool}` : ""}
            </span>
            <span className="perm__action">{permission.action}</span>
          </div>
          {permission.message ? <div className="perm__message">{permission.message}</div> : null}
          {permission.resources.length > 0 ? (
            <div className="perm__resources">
              {permission.resources.map((resource, index) => (
                <pre className="perm__resource" key={index}>
                  {resource}
                </pre>
              ))}
            </div>
          ) : null}
          <div className="perm__actions">
            <button
              type="button"
              className="perm__button perm__button--primary"
              onClick={() => onReply(permission.id, "once")}
            >
              Allow once
            </button>
            <button type="button" className="perm__button" onClick={() => onReply(permission.id, "always")}>
              Always allow
            </button>
            <button
              type="button"
              className="perm__button perm__button--deny"
              onClick={() => onReply(permission.id, "reject")}
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
