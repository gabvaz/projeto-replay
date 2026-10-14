import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminFetch, errorText, VENUE_STATUS_LABEL, type VenueStatus } from "../api";
import { Button, ErrorNote, Field, inputCls, Modal } from "../ui";

export type VenueFields = {
  name: string;
  city: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  status: VenueStatus;
  notes: string;
};

const EMPTY: VenueFields = {
  name: "",
  city: "",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  status: "onboarding",
  notes: "",
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Sem id = criar. */
  venueId?: string;
  initial?: Partial<Record<keyof VenueFields, string | null>>;
  onSaved?: (id: string) => void;
};

export function VenueFormModal({ open, onClose, venueId, initial, onSaved }: Props) {
  const qc = useQueryClient();
  const [f, setF] = useState<VenueFields>(
    () =>
      Object.fromEntries(
        Object.entries(EMPTY).map(([k, empty]) => [k, initial?.[k as keyof VenueFields] ?? empty]),
      ) as VenueFields,
  );
  const set = (k: keyof VenueFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () =>
      venueId
        ? adminFetch<{ ok: true }>(`/venues/${venueId}`, "PATCH", f).then(() => ({ id: venueId }))
        : adminFetch<{ id: string }>("/venues", "POST", f),
    onSuccess: ({ id }) => {
      void qc.invalidateQueries();
      onSaved?.(id);
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={venueId ? "Editar arena" : "Nova arena"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Nome">
            <input className={inputCls} value={f.name} onChange={set("name")} placeholder="Arena Beach Recife" autoFocus />
          </Field>
        </div>
        <Field label="Cidade">
          <input className={inputCls} value={f.city} onChange={set("city")} placeholder="Recife/PE" />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={f.status} onChange={set("status")}>
            {Object.entries(VENUE_STATUS_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contato">
          <input className={inputCls} value={f.contact_name} onChange={set("contact_name")} placeholder="Nome do responsável" />
        </Field>
        <Field label="WhatsApp">
          <input className={inputCls} value={f.contact_phone} onChange={set("contact_phone")} placeholder="(81) 9…" inputMode="tel" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="E-mail">
            <input className={inputCls} value={f.contact_email} onChange={set("contact_email")} type="email" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Observações">
            <textarea className={`${inputCls} min-h-20`} value={f.notes} onChange={set("notes")} />
          </Field>
        </div>
      </div>
      <div className="mt-4">
        <ErrorNote>{save.error && errorText(save.error)}</ErrorNote>
      </div>
    </Modal>
  );
}
