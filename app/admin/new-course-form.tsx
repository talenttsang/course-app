"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCourse } from "./actions";
import { slugify } from "@/lib/lesson-source";

export function NewCourseForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [productId, setProductId] = useState("");
  const [error, setError] = useState("");

  // The slug follows the title until staff edit it themselves.
  const effectiveSlug = slugTouched ? slug : slugify(title);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const result = await createCourse({ title, slug: effectiveSlug, description, productId });
      if (result.ok) {
        setTitle("");
        setSlug("");
        setSlugTouched(false);
        setDescription("");
        setProductId("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="admin-card">
      <div className="admin-grid">
        <div>
          <label className="field-label" htmlFor="title">Course title</label>
          <input
            id="title"
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Women's Hair Replacement Specialist Program: Starter"
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="pid">BigCommerce product ID</label>
          <input
            id="pid"
            className="field-input"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            placeholder="3465"
            inputMode="numeric"
            required
          />
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <label className="field-label" htmlFor="slug">Web address</label>
        <input
          id="slug"
          className="field-input"
          value={effectiveSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          placeholder="womens-hair-replacement-starter"
        />
        <p className="admin-hint">
          Students will find this course at /course/{effectiveSlug || "…"}
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <label className="field-label" htmlFor="desc">Description (optional)</label>
        <textarea
          id="desc"
          className="field-input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What students will learn in this program."
        />
      </div>

      {error && <p className="auth-error">{error}</p>}

      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 20 }}>
        {pending ? "Adding…" : "Add course"}
      </button>
    </form>
  );
}
