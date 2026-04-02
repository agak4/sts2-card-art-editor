extends Node

const STORAGE_ROOT := "user://card_art_editor"
const STORAGE_IMAGE_DIR := STORAGE_ROOT + "/overrides"
const STORAGE_EDIT_SOURCE_DIR := STORAGE_ROOT + "/edit_sources"
const STORAGE_GIF_TEMP_DIR := STORAGE_ROOT + "/gif_temp"
const STORAGE_PCK_TEMP_DIR := STORAGE_ROOT + "/pck_temp"
const STORAGE_MANIFEST_PATH := STORAGE_ROOT + "/manifest.json"
const GIF_TOOL_RES_PATH := "res://mods/card_art_editor/extract_gif_frames.ps1"
const GIF_TOOL_USER_PATH := STORAGE_ROOT + "/tools/extract_gif_frames.ps1"
const PICTURES_EXTRACT_SUBDIR := "card_art_editor_extracted"
const BUNDLE_VERSION := 1
const MANAGED_TEXTURE_PREFIX := "res://images/packed/card_portraits/"
const CARD_ATLAS_PREFIX := "res://images/atlases/card_atlas.sprites/"
const DEFAULT_LANDSCAPE_SIZE := Vector2i(1000, 760)
const DEFAULT_PORTRAIT_SIZE := Vector2i(606, 852)
const FULL_ART_TARGET_SIZE := Vector2i(600, 847)
const MOD_IMPORT_IMAGE_EXTENSIONS := ["png", "jpg", "jpeg", "webp", "gif"]
const CARD_PORTRAIT_FOLDERS := ["regent", "silent", "ironclad", "seeker", "colorless", "status", "token", "curse", "event", "necrobinder"]
const REFRESH_INTERVAL := 0.0
const DISPLAY_MODE_DEFAULT := "default"
const DISPLAY_MODE_FULL_ART := "full_art"
const FULL_ART_STATIC_ZOOM_BOOST := 1.12
const FULL_ART_ANIMATED_ZOOM_BOOST := 1.22
const FULL_ART_MASK_MATERIAL = preload("res://scenes/cards/card_canvas_group_mask_material.tres")
const PCK_MAGIC := 0x43504447 # GDPC
const PCK_HEADER_VERSION_FIELDS := 4
const PCK_HEADER_RESERVED_FIELDS := 16

const META_SOURCE_PATH := "_card_art_source_path"
const META_SOURCE_SIZE := "_card_art_source_size"
const META_ORIGINAL_TEXTURE := "_card_art_original_texture"
const META_OVERRIDE_ACTIVE := "_card_art_override_active"
const META_FULL_ART_ACTIVE := "_card_art_full_art_active"
const META_FULL_ART_OWNER_PATH := "_card_art_full_art_owner_path"
const META_INSPECT_SOURCE_PATH := "_card_art_inspect_source_path"
const META_PORTRAIT_GROUP_ORIGINAL_MATERIAL := "_card_art_portrait_group_original_material"
const FULL_ART_LAYER_NAME := "CardArtFullArtLayer"
const FULL_ART_INSET_STATIC := 0
const FULL_ART_INSET_ANIMATED := 0

signal overrides_changed(source_path)

var _portrait_refs := []
var _manifest := {}
var _override_texture_cache := {}
var _refresh_accumulator := 0.0
var _session_api_key := ""
var _overlay_scene := preload("res://mods/card_art_editor/inspect_card_art_editor.tscn")


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_ensure_storage()
	_load_manifest()
	get_tree().node_added.connect(_on_node_added)
	_register_existing(get_tree().root)


func _process(delta: float) -> void:
	if REFRESH_INTERVAL <= 0.0:
		_refresh_tracked_portraits()
		return
	_refresh_accumulator += delta
	if _refresh_accumulator < REFRESH_INTERVAL:
		return
	_refresh_accumulator = 0.0
	_refresh_tracked_portraits()


func get_session_api_key() -> String:
	return _session_api_key


func set_session_api_key(api_key: String) -> void:
	_session_api_key = api_key.strip_edges()


func has_override(source_path: String) -> bool:
	return _manifest.has(source_path)


func can_toggle_full_art(source_path: String) -> bool:
	if !_manifest.has(source_path):
		return false
	var target_size = get_target_size_for_source_path(source_path)
	return target_size.x > target_size.y


func get_display_mode(source_path: String) -> String:
	var entry = _manifest.get(source_path, null)
	if !(entry is Dictionary):
		return DISPLAY_MODE_DEFAULT
	var mode = String(entry.get("display_mode", DISPLAY_MODE_DEFAULT))
	return mode if mode != "" else DISPLAY_MODE_DEFAULT


func is_full_art_mode(source_path: String) -> bool:
	return get_display_mode(source_path) == DISPLAY_MODE_FULL_ART


func toggle_display_mode(source_path: String) -> Dictionary:
	if !_manifest.has(source_path):
		return {
			"ok": false,
			"message": "No custom image is applied to this card."
		}
	if !can_toggle_full_art(source_path):
		return {
			"ok": false,
			"message": "Full-art mode is only available for regular landscape cards."
		}
	var entry = _manifest.get(source_path, null)
	if !(entry is Dictionary):
		return {
			"ok": false,
			"message": "The current card image could not be updated."
		}
	var next_mode = DISPLAY_MODE_DEFAULT if is_full_art_mode(source_path) else DISPLAY_MODE_FULL_ART
	var rebuild_result = _rebuild_override_for_display_mode(source_path, next_mode, entry)
	if !bool(rebuild_result.get("ok", false)):
		return rebuild_result
	return {
		"ok": true,
		"message": "Full-art style enabled." if next_mode == DISPLAY_MODE_FULL_ART else "Full-art style disabled."
	}


func _rebuild_override_for_display_mode(source_path: String, display_mode: String, existing_entry: Dictionary = {}) -> Dictionary:
	var entry = existing_entry if !existing_entry.is_empty() else _manifest.get(source_path, {})
	if !(entry is Dictionary):
		return {
			"ok": false,
			"message": "The current card image could not be rebuilt."
		}

	if _is_animated_entry(entry):
		var source_frames = entry.get("source_frame_paths", entry.get("frame_paths", []))
		var frame_delays = entry.get("frame_delays", [])
		if !(source_frames is Array) or source_frames.is_empty():
			return {
				"ok": false,
				"message": "The current animated card image could not be rebuilt."
			}
		var images: Array = []
		var delays: Array = []
		for index in range(source_frames.size()):
			var frame_image = load_image_from_file(ProjectSettings.globalize_path(String(source_frames[index])))
			if frame_image == null:
				continue
			images.append(frame_image)
			delays.append(max(0.02, float(frame_delays[index]) if index < frame_delays.size() else 0.1))
		if images.is_empty():
			return {
				"ok": false,
				"message": "The current animated card image could not be rebuilt."
			}
		var animated_result = save_animated_override_images(source_path, images, delays, display_mode)
		if bool(animated_result.get("ok", false)):
			var updated_entry = _manifest.get(source_path, null)
			if updated_entry is Dictionary:
				updated_entry["adjust_zoom"] = 1.0
				updated_entry["adjust_offset_x"] = 0.0
				updated_entry["adjust_offset_y"] = 0.0
				_manifest[source_path] = updated_entry
				_save_manifest()
		return animated_result

	var edit_source_path = String(entry.get("edit_source_path", entry.get("override_path", "")))
	if edit_source_path == "":
		return {
			"ok": false,
			"message": "The current card image could not be rebuilt."
		}
	var source_image = load_image_from_file(ProjectSettings.globalize_path(edit_source_path))
	if source_image == null:
		return {
			"ok": false,
			"message": "The current card image could not be rebuilt."
		}
	return save_override_image(source_path, source_image, display_mode)


func can_adjust_override(source_path: String) -> bool:
	if !_manifest.has(source_path):
		return false
	var entry = _manifest.get(source_path, null)
	return entry is Dictionary


func get_override_adjustment_state(source_path: String) -> Dictionary:
	var entry = _manifest.get(source_path, null)
	if !(entry is Dictionary):
		return {
			"zoom": 1.0,
			"offset_x": 0.0,
			"offset_y": 0.0
		}
	return {
		"zoom": float(entry.get("adjust_zoom", 1.0)),
		"offset_x": float(entry.get("adjust_offset_x", 0.0)),
		"offset_y": float(entry.get("adjust_offset_y", 0.0))
	}


func get_adjustable_override_image(source_path: String):
	if !can_adjust_override(source_path):
		return null
	var payload = get_adjustable_override_payload(source_path)
	if payload.is_empty():
		return null
	return payload.get("preview_image", null)


func get_adjustable_override_payload(source_path: String) -> Dictionary:
	if !can_adjust_override(source_path):
		return {}
	var entry = _manifest.get(source_path, null)
	if !(entry is Dictionary):
		return {}
	if _is_animated_entry(entry):
		var images: Array = []
		var delays: Array = []
		var frame_paths = entry.get("source_frame_paths", entry.get("frame_paths", []))
		var frame_delays = entry.get("frame_delays", [])
		if !(frame_paths is Array):
			return {}
		for index in range(frame_paths.size()):
			var image = load_image_from_file(ProjectSettings.globalize_path(String(frame_paths[index])))
			if image == null:
				continue
			images.append(image)
			delays.append(float(frame_delays[index]) if index < frame_delays.size() else 0.1)
		if images.is_empty():
			return {}
		return {
			"type": "animated_gif",
			"images": images,
			"delays": delays,
			"preview_image": images[0]
		}

	var source_path_key = String(entry.get("edit_source_path", entry.get("override_path", "")))
	if source_path_key == "":
		return {}
	var source_image = load_image_from_file(ProjectSettings.globalize_path(source_path_key))
	if source_image == null:
		return {}
	return {
		"type": "static",
		"image": source_image,
		"preview_image": source_image
	}


func get_override_count() -> int:
	return _manifest.size()


func get_source_path_for_texture_rect(texture_rect) -> String:
	if texture_rect == null:
		return ""
	_refresh_portrait_node(texture_rect)
	return String(texture_rect.get_meta(META_SOURCE_PATH, ""))


func get_source_path_for_card_node(card_node) -> String:
	if card_node == null:
		return ""
	if card_node.has_meta(META_INSPECT_SOURCE_PATH):
		var inspect_source_path = String(card_node.get_meta(META_INSPECT_SOURCE_PATH, ""))
		if inspect_source_path != "":
			return inspect_source_path
	var portrait_canvas_group = card_node.get_node_or_null("CardContainer/PortraitCanvasGroup")
	var ancient_portrait = card_node.get_node_or_null("CardContainer/PortraitCanvasGroup/AncientPortrait")
	var portrait = card_node.get_node_or_null("CardContainer/PortraitCanvasGroup/Portrait")
	if ancient_portrait is TextureRect and ancient_portrait.visible:
		var visible_ancient_source = get_source_path_for_texture_rect(ancient_portrait)
		if visible_ancient_source != "":
			return visible_ancient_source
		var direct_ancient_path = _resolve_texture_source_path(ancient_portrait, ancient_portrait.texture)
		if direct_ancient_path != "":
			return direct_ancient_path
	if portrait is TextureRect and portrait.visible:
		var visible_portrait_source = get_source_path_for_texture_rect(portrait)
		if visible_portrait_source != "":
			return visible_portrait_source
		var direct_portrait_path = _resolve_texture_source_path(portrait, portrait.texture)
		if direct_portrait_path != "":
			return direct_portrait_path
	var direct_model_path = get_source_path_for_model(card_node.get("Model"))
	if direct_model_path != "":
		return direct_model_path
	var current = card_node
	while current != null:
		var model = current.get("Model")
		var model_path = get_source_path_for_model(model)
		if model_path != "":
			return model_path
		current = current.get_parent()
	if portrait_canvas_group != null:
		var full_art_layer = portrait_canvas_group.get_node_or_null(FULL_ART_LAYER_NAME)
		if full_art_layer is TextureRect and bool(full_art_layer.get_meta(META_FULL_ART_ACTIVE, false)):
			var full_art_owner = String(full_art_layer.get_meta(META_FULL_ART_OWNER_PATH, ""))
			if full_art_owner != "":
				return full_art_owner
	if ancient_portrait is TextureRect:
		return get_source_path_for_texture_rect(ancient_portrait)
	if portrait is TextureRect:
		return get_source_path_for_texture_rect(portrait)
	return ""


func get_source_path_for_model(model) -> String:
	return _extract_model_portrait_path(model)


func get_target_size_for_source_path(source_path: String) -> Vector2i:
	if source_path == "":
		return DEFAULT_LANDSCAPE_SIZE

	var manifest_entry = _manifest.get(source_path, null)
	if manifest_entry is Dictionary and manifest_entry.has("width") and manifest_entry.has("height"):
		return Vector2i(int(manifest_entry["width"]), int(manifest_entry["height"]))

	var texture = load(source_path)
	if texture is Texture2D:
		return Vector2i(texture.get_width(), texture.get_height())

	if source_path.contains("ancient"):
		return DEFAULT_PORTRAIT_SIZE

	return DEFAULT_LANDSCAPE_SIZE


func get_generation_size_for_source_path(source_path: String) -> String:
	var target_size = get_target_size_for_source_path(source_path)
	if target_size.x == target_size.y:
		return "1024x1024"
	if target_size.x > target_size.y:
		return "1536x1024"
	return "1024x1536"


func get_source_image_bytes(source_path: String) -> PackedByteArray:
	var image = get_source_image(source_path)
	if image == null:
		return PackedByteArray()
	return image.save_png_to_buffer()


func get_source_image(source_path: String):
	if source_path == "":
		return null

	var texture = load(source_path)
	if texture is Texture2D:
		return texture.get_image()

	return null


func export_source_image_to_png(source_path: String, export_path: String) -> Dictionary:
	if source_path == "":
		return {
			"ok": false,
			"message": "No card art is selected."
		}
	var image = null
	var exported_animated_frame = false
	var entry = _manifest.get(source_path, null)
	if entry is Dictionary:
		var display_mode = String(entry.get("display_mode", DISPLAY_MODE_DEFAULT))
		if _is_animated_entry(entry):
			var frame_paths = entry.get("source_frame_paths", entry.get("frame_paths", [])) if display_mode == DISPLAY_MODE_FULL_ART else entry.get("frame_paths", [])
			if frame_paths is Array and !frame_paths.is_empty():
				image = load_image_from_file(ProjectSettings.globalize_path(String(frame_paths[0])))
				if image != null and display_mode == DISPLAY_MODE_FULL_ART:
					image = trim_transparent_margins(image)
					image = build_full_art_preview(source_path, image, Vector2i.ZERO, FULL_ART_ANIMATED_ZOOM_BOOST)
				exported_animated_frame = true
		else:
			var image_path = ""
			if display_mode == DISPLAY_MODE_FULL_ART:
				image_path = String(entry.get("edit_source_path", entry.get("override_path", "")))
			else:
				image_path = String(entry.get("override_path", entry.get("edit_source_path", "")))
			if image_path != "":
				image = load_image_from_file(ProjectSettings.globalize_path(image_path))
				if image != null and display_mode == DISPLAY_MODE_FULL_ART:
					image = build_full_art_preview(source_path, image)
	if image == null:
		image = get_source_image(source_path)
	if image == null:
		return {
			"ok": false,
			"message": "Could not load the current card image."
		}
	var normalized_export_path = export_path
	if !normalized_export_path.to_lower().ends_with(".png"):
		normalized_export_path += ".png"
	if image.save_png(normalized_export_path) != OK:
		return {
			"ok": false,
			"message": "Failed to save the PNG file."
		}
	return {
		"ok": true,
		"message": "Saved the current custom card image as PNG." if !exported_animated_frame else "Saved the first frame of the current custom animated card image as PNG."
	}


func _build_card_source_index() -> Dictionary:
	var exact_map := {}
	var basename_map := {}
	var normalized_map := {}
	var preferred_basename_map := {}
	var sources: Array = []
	var source_paths: Array = []
	_collect_card_source_paths(MANAGED_TEXTURE_PREFIX.trim_suffix("/"), source_paths)
	for source_path in source_paths:
		var normalized_source = String(source_path).replace("\\", "/")
		var key_exact = normalized_source.trim_prefix(MANAGED_TEXTURE_PREFIX).trim_suffix(".png").to_lower()
		if key_exact != "":
			exact_map[key_exact] = normalized_source
		var basename = normalized_source.get_file().get_basename().to_lower()
		if basename == "":
			continue
		if !basename_map.has(basename):
			basename_map[basename] = []
		(basename_map[basename] as Array).append(normalized_source)
		if !preferred_basename_map.has(basename):
			preferred_basename_map[basename] = normalized_source
		elif String(preferred_basename_map[basename]).find("/beta/") >= 0 and normalized_source.find("/beta/") < 0:
			preferred_basename_map[basename] = normalized_source
		var normalized_name = _normalize_card_match_key(basename)
		if normalized_name != "":
			if !normalized_map.has(normalized_name):
				normalized_map[normalized_name] = []
			(normalized_map[normalized_name] as Array).append(normalized_source)
		sources.append({
			"source_path": normalized_source,
			"basename": basename,
			"tokens": _tokenize_card_match_key(basename)
		})
	return {
		"exact": exact_map,
		"basename": basename_map,
		"preferred_basename": preferred_basename_map,
		"normalized": normalized_map,
		"sources": sources
	}


func _collect_card_source_paths(dir_path: String, output: Array) -> void:
	var dir = DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	while true:
		var entry_name = dir.get_next()
		if entry_name == "":
			break
		if entry_name == "." or entry_name == "..":
			continue
		var full_path = dir_path.path_join(entry_name)
		if dir.current_is_dir():
			_collect_card_source_paths(full_path, output)
		elif entry_name.get_extension().to_lower() == "png":
			output.append(full_path)
	dir.list_dir_end()


func _collect_mod_image_paths(dir_path: String, output: Array) -> void:
	var dir = DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	while true:
		var entry_name = dir.get_next()
		if entry_name == "":
			break
		if entry_name == "." or entry_name == "..":
			continue
		var full_path = dir_path.path_join(entry_name)
		if dir.current_is_dir():
			_collect_mod_image_paths(full_path, output)
		elif MOD_IMPORT_IMAGE_EXTENSIONS.has(entry_name.get_extension().to_lower()):
			output.append(full_path)
	dir.list_dir_end()


func _resolve_mod_pck_path(mod_root: String, mod_id: String, import_path: String) -> String:
	var candidates: Array = []
	if mod_id != "":
		candidates.append(mod_root.path_join("%s.pck" % mod_id))
	var import_basename = import_path.get_file().get_basename()
	if import_basename != "":
		candidates.append(mod_root.path_join("%s.pck" % import_basename))
	var dir = DirAccess.open(mod_root)
	if dir != null:
		dir.list_dir_begin()
		while true:
			var entry_name = dir.get_next()
			if entry_name == "":
				break
			if dir.current_is_dir():
				continue
			if entry_name.get_extension().to_lower() == "pck":
				candidates.append(mod_root.path_join(entry_name))
		dir.list_dir_end()
	for candidate in candidates:
		if FileAccess.file_exists(String(candidate)):
			return String(candidate)
	return ""


func _extract_pck_images(pck_path: String) -> Dictionary:
	var output_result = _prepare_pck_extract_output_dir(pck_path)
	if !bool(output_result.get("ok", false)):
		return output_result
	var output_dir = String(output_result.get("output_dir", ""))
	var save_notice = String(output_result.get("save_notice", ""))

	var parse_result = _parse_pck_entries(pck_path)
	if !bool(parse_result.get("ok", false)):
		return {
			"ok": false,
			"message": String(parse_result.get("message", "PCK image extraction failed."))
		}

	var context = {
		"pck_path": pck_path,
		"output_dir": output_dir,
		"entries": parse_result.get("entries", []),
		"candidate_paths": _collect_candidate_paths_from_pck_binary(pck_path)
	}
	var strategy_result = _run_pck_extract_strategies(context)
	_write_pck_extract_metadata(output_dir, strategy_result, context)

	return {
		"ok": true,
		"temp_dir": output_dir,
		"saved_dir": output_dir,
		"save_notice": save_notice
	}


func _prepare_pck_extract_output_dir(pck_path: String) -> Dictionary:
	var preferred_output_dir = _get_pictures_extract_output_dir(pck_path)
	var output_dir = preferred_output_dir
	var save_notice = ""
	if output_dir != "":
		DirAccess.make_dir_recursive_absolute(output_dir)
		if !DirAccess.dir_exists_absolute(output_dir):
			save_notice = "Could not create the game mod extraction folder: %s" % output_dir
			output_dir = ""
	if output_dir == "":
		output_dir = ProjectSettings.globalize_path("%s/%s_%d" % [
			STORAGE_PCK_TEMP_DIR,
			_safe_file_stem(pck_path.get_file()),
			Time.get_ticks_msec()
		])
		DirAccess.make_dir_recursive_absolute(output_dir)
		if !DirAccess.dir_exists_absolute(output_dir):
			return {
				"ok": false,
				"message": "Failed to create any extraction folder.%s" % (" %s" % save_notice if save_notice != "" else "")
			}
	return {
		"ok": true,
		"output_dir": output_dir,
		"save_notice": save_notice
	}


func _run_pck_extract_strategies(context: Dictionary) -> Dictionary:
	var strategies: Array = [
		{"name": "pck_entries", "callable": Callable(self, "_extract_images_from_pck_entries")},
		{"name": "embedded_webp", "callable": Callable(self, "_extract_images_from_embedded_webp")}
	]
	var exported_files: Array = []
	var strategy_results: Array = []

	for strategy in strategies:
		var strategy_name = String((strategy as Dictionary).get("name", "unknown"))
		var strategy_callable = (strategy as Dictionary).get("callable")
		if !(strategy_callable is Callable):
			continue
		var result = (strategy_callable as Callable).call(context)
		var files = result.get("files", [])
		var exported_count := 0
		if files is Array:
			for file_path in files:
				exported_files.append(String(file_path))
			exported_count = files.size()
		strategy_results.append({
			"name": strategy_name,
			"count": exported_count
		})
		if exported_count > 0:
			break

	return {
		"count": exported_files.size(),
		"files": exported_files,
		"strategies": strategy_results
	}


func _extract_images_from_pck_entries(context: Dictionary) -> Dictionary:
	var pck_path = String(context.get("pck_path", ""))
	var output_dir = String(context.get("output_dir", ""))
	var entries = context.get("entries", [])
	var exported_files: Array = []
	if entries is Array:
		for entry in entries:
			if _export_pck_image_entry(pck_path, entry, output_dir):
				exported_files.append(String((entry as Dictionary).get("path", "")))
	return {
		"files": exported_files
	}


func _extract_images_from_embedded_webp(context: Dictionary) -> Dictionary:
	return _extract_embedded_webp_images(
		String(context.get("pck_path", "")),
		String(context.get("output_dir", ""))
	)


func _write_pck_extract_metadata(output_dir: String, strategy_result: Dictionary, context: Dictionary) -> void:
	var metadata_path = output_dir.path_join("metadata.json")
	var metadata_file = FileAccess.open(metadata_path, FileAccess.WRITE)
	if metadata_file == null:
		return
	var entries = context.get("entries", [])
	var candidate_paths = context.get("candidate_paths", [])
	var exported_files = strategy_result.get("files", [])
	var strategies = strategy_result.get("strategies", [])
	metadata_file.store_string(JSON.stringify({
		"saved_dir": output_dir,
		"count": int(strategy_result.get("count", 0)),
		"entry_count": entries.size() if entries is Array else 0,
		"candidate_count": candidate_paths.size() if candidate_paths is Array else 0,
		"files": exported_files,
		"strategies": strategies,
		"sample_candidates": candidate_paths.slice(0, min(20, candidate_paths.size())) if candidate_paths is Array else []
	}, "\t"))


func _get_pictures_extract_output_dir(pck_path: String) -> String:
	var pictures_dir = OS.get_system_dir(OS.SYSTEM_DIR_PICTURES)
	if pictures_dir == "":
		var user_profile = OS.get_environment("USERPROFILE")
		if user_profile != "":
			pictures_dir = user_profile.path_join("Pictures")
	if pictures_dir == "":
		return ""
	return pictures_dir.path_join(PICTURES_EXTRACT_SUBDIR).path_join("%s_%d" % [
		_safe_file_stem(pck_path.get_file()),
		Time.get_ticks_msec()
	])


func _parse_pck_entries(pck_path: String) -> Dictionary:
	var file = FileAccess.open(pck_path, FileAccess.READ)
	if file == null:
		return {
			"ok": false,
			"message": "Could not open the selected PCK file."
		}
	if file.get_length() < 4:
		return {
			"ok": false,
			"message": "The selected PCK file is too small to be valid."
		}
	if file.get_32() != PCK_MAGIC:
		return {
			"ok": false,
			"message": "The selected file is not a supported Godot PCK archive."
		}

	for _index in range(PCK_HEADER_VERSION_FIELDS):
		file.get_32()
	for _index in range(PCK_HEADER_RESERVED_FIELDS):
		file.get_32()

	if file.get_position() + 4 > file.get_length():
		return {
			"ok": false,
			"message": "The PCK header ended unexpectedly."
		}

	var file_count = file.get_32()
	var entries: Array = []
	for _index in range(file_count):
		if file.get_position() + 4 > file.get_length():
			break
		var path_length = file.get_32()
		if path_length <= 0 or file.get_position() + path_length > file.get_length():
			break
		var path = file.get_buffer(path_length).get_string_from_utf8()
		if file.get_position() + 8 + 8 + 16 > file.get_length():
			break
		var offset = file.get_64()
		var size = file.get_64()
		file.get_buffer(16)
		entries.append({
			"path": _normalize_pck_entry_path(path),
			"offset": offset,
			"size": size
		})

	return {
		"ok": true,
		"entries": entries
	}


func _extract_embedded_webp_images(pck_path: String, output_dir: String) -> Dictionary:
	var bytes = FileAccess.get_file_as_bytes(pck_path)
	if bytes.is_empty():
		return {"count": 0, "files": []}
	var ordered_names = _collect_ordered_card_names_from_pck_binary(bytes)
	var webp_chunks = _collect_embedded_webp_chunks(bytes)
	if webp_chunks.is_empty():
		return {"count": 0, "files": []}
	var export_chunks = _select_webp_chunks_for_export(webp_chunks, ordered_names.size())
	var extracted_files: Array = []
	for chunk_index in range(export_chunks.size()):
		var chunk = export_chunks[chunk_index]
		var index = int((chunk as Dictionary).get("offset", -1))
		var total_size = int((chunk as Dictionary).get("size", 0))
		if index < 0 or total_size <= 12 or index + total_size > bytes.size():
			continue
		var file_name = "embedded_%03d.webp" % chunk_index
		if chunk_index < ordered_names.size():
			var sequential_name = String(ordered_names[chunk_index])
			if sequential_name != "":
				file_name = "%s.webp" % sequential_name
		var output_path = output_dir.path_join(file_name)
		DirAccess.make_dir_recursive_absolute(output_path.get_base_dir())
		var out_file = FileAccess.open(output_path, FileAccess.WRITE)
		if out_file != null:
			out_file.store_buffer(bytes.slice(index, index + total_size))
			extracted_files.append(output_path)
	return {
		"count": extracted_files.size(),
		"files": extracted_files
	}


func _collect_embedded_webp_chunks(bytes: PackedByteArray) -> Array:
	var chunks: Array = []
	var index := 0
	while index <= bytes.size() - 12:
		var is_riff = bytes[index] == 0x52 and bytes[index + 1] == 0x49 and bytes[index + 2] == 0x46 and bytes[index + 3] == 0x46
		var is_webp = bytes[index + 8] == 0x57 and bytes[index + 9] == 0x45 and bytes[index + 10] == 0x42 and bytes[index + 11] == 0x50
		if !is_riff or !is_webp:
			index += 1
			continue
		var riff_size = bytes[index + 4] | (bytes[index + 5] << 8) | (bytes[index + 6] << 16) | (bytes[index + 7] << 24)
		var total_size = int(riff_size) + 8
		if total_size <= 12 or index + total_size > bytes.size():
			index += 1
			continue
		chunks.append({
			"offset": index,
			"size": total_size
		})
		index += total_size
	return chunks


func _select_webp_chunks_for_export(chunks: Array, expected_named_count: int) -> Array:
	if chunks.is_empty():
		return []
	if expected_named_count <= 0 or chunks.size() <= expected_named_count:
		return chunks

	var grouped_chunks: Array = []
	var current_group: Array = [chunks[0]]
	var previous_size = int((chunks[0] as Dictionary).get("size", 0))
	for index in range(1, chunks.size()):
		var chunk = chunks[index]
		var chunk_size = int((chunk as Dictionary).get("size", 0))
		if chunk_size > previous_size:
			grouped_chunks.append(current_group)
			current_group = [chunk]
		else:
			current_group.append(chunk)
		previous_size = chunk_size
	if !current_group.is_empty():
		grouped_chunks.append(current_group)

	if grouped_chunks.size() >= expected_named_count and grouped_chunks.size() <= expected_named_count + 4:
		var selected: Array = []
		for group in grouped_chunks:
			if group is Array and !group.is_empty():
				selected.append(group[0])
		return selected

	return chunks


func _collect_ordered_card_names_from_pck_binary(bytes: PackedByteArray) -> Array:
	var ordered: Array = []
	var seen := {}
	var printable_strings = _extract_printable_pck_strings(bytes)
	for strategy in _get_pck_card_name_extract_strategies():
		var regex = _compile_pck_card_name_regex(String((strategy as Dictionary).get("pattern", "")))
		if regex == null:
			continue
		_extract_card_names_from_printable_strings(
			printable_strings,
			regex,
			bool((strategy as Dictionary).get("camel_to_snake", true)),
			ordered,
			seen
		)
	return ordered


func _get_pck_card_name_extract_strategies() -> Array:
	return [
		{
			"name": "megacrit_cards_namespace",
			"pattern": "MegaCrit\\.Sts2\\.Core\\.Models\\.Cards\\.([A-Za-z0-9]+)\\.png",
			"camel_to_snake": true
		},
		{
			"name": "godot_imported_ctex",
			"pattern": "res://\\.godot/imported/([A-Za-z0-9_]+)\\.png-[0-9a-f]+\\.ctex",
			"camel_to_snake": true
		},
		{
			"name": "card_portraits_path",
			"pattern": "res://[^\\s\\x00]*/card_portraits/[^\\s\\x00]*/([A-Za-z0-9_]+)\\.png",
			"camel_to_snake": true
		}
	]


func _compile_pck_card_name_regex(pattern: String) -> Variant:
	if pattern == "":
		return null
	var regex = RegEx.new()
	if regex.compile(pattern) != OK:
		return null
	return regex


func _extract_card_names_from_printable_strings(printable_strings: Array, regex: RegEx, camel_to_snake: bool, ordered: Array, seen: Dictionary) -> void:
	for printable in printable_strings:
		var text = String(printable)
		var local_matches = regex.search_all(text)
		for match in local_matches:
			var raw_name = String(match.get_string(1))
			var resolved_name = _camel_to_snake_case_match_key(raw_name) if camel_to_snake else raw_name.strip_edges().to_lower()
			if resolved_name == "" or seen.has(resolved_name):
				continue
			seen[resolved_name] = true
			ordered.append(resolved_name)


func _normalize_pck_entry_path(path: String) -> String:
	var normalized = path.replace("\\", "/").strip_edges()
	if normalized.begins_with("res://"):
		return normalized
	return "res://%s" % normalized.trim_prefix("/")


func _collect_candidate_paths_from_pck_binary(pck_path: String) -> Array:
	var data = FileAccess.get_file_as_bytes(pck_path)
	if data.is_empty():
		return []
	var strings = _extract_printable_pck_strings(data)
	var paths := {}
	for text in strings:
		var lower_text = text.to_lower()
		for extension in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".png.import", ".jpg.import", ".jpeg.import", ".webp.import", ".gif.import"]:
			if lower_text.ends_with(extension):
				paths[_normalize_pck_entry_path(text)] = true
				break
	return paths.keys()


func _extract_printable_pck_strings(data: PackedByteArray) -> Array:
	var results: Array = []
	var current := PackedByteArray()
	for byte in data:
		var is_printable = (byte >= 48 and byte <= 57) or (byte >= 65 and byte <= 90) or (byte >= 97 and byte <= 122) or byte == 46 or byte == 47 or byte == 58 or byte == 95 or byte == 45
		if is_printable:
			current.append(byte)
			continue
		if current.size() >= 8:
			results.append(current.get_string_from_ascii())
		current = PackedByteArray()
	if current.size() >= 8:
		results.append(current.get_string_from_ascii())
	return results


func _export_pck_image_entry(pck_path: String, entry: Dictionary, output_dir: String) -> bool:
	var entry_path = String(entry.get("path", ""))
	if entry_path == "":
		return false
	var extension = entry_path.get_extension().to_lower()
	if !MOD_IMPORT_IMAGE_EXTENSIONS.has(extension):
		return false
	var bytes = _read_pck_entry_bytes(pck_path, entry)
	if bytes.is_empty():
		return false
	var output_path = output_dir.path_join(entry_path.trim_prefix("res://"))
	DirAccess.make_dir_recursive_absolute(output_path.get_base_dir())
	var out_file = FileAccess.open(output_path, FileAccess.WRITE)
	if out_file == null:
		return false
	out_file.store_buffer(bytes)
	return true


func _read_pck_entry_bytes(pck_path: String, entry: Dictionary) -> PackedByteArray:
	var file = FileAccess.open(pck_path, FileAccess.READ)
	if file == null:
		return PackedByteArray()
	var offset = int(entry.get("offset", 0))
	var size = int(entry.get("size", 0))
	if offset < 0 or size <= 0 or offset + size > file.get_length():
		return PackedByteArray()
	file.seek(offset)
	return file.get_buffer(size)


func _match_card_source_for_mod_image(image_path: String, source_index: Dictionary) -> Dictionary:
	var original_path = image_path.replace("\\", "/")
	var normalized_path = original_path.to_lower()
	var exact_map = source_index.get("exact", {})
	var basename_map = source_index.get("basename", {})
	var preferred_basename_map = source_index.get("preferred_basename", {})
	var normalized_map = source_index.get("normalized", {})
	var sources = source_index.get("sources", [])
	var card_portraits_marker = "/card_portraits/"
	var marker_index = normalized_path.find(card_portraits_marker)
	if marker_index >= 0:
		var relative_key = normalized_path.substr(marker_index + card_portraits_marker.length()).trim_suffix(".png").trim_suffix(".jpg").trim_suffix(".jpeg").trim_suffix(".webp").trim_suffix(".gif")
		if exact_map is Dictionary and (exact_map as Dictionary).has(relative_key):
			return {"source_path": (exact_map as Dictionary)[relative_key], "ambiguous": false}
	var basename = original_path.get_file().get_basename().to_lower()
	var original_basename = original_path.get_file().get_basename()
	if preferred_basename_map is Dictionary and (preferred_basename_map as Dictionary).has(basename):
		return {"source_path": (preferred_basename_map as Dictionary)[basename], "ambiguous": false}
	var direct_source_path = _resolve_source_path_from_basename(basename)
	if direct_source_path != "":
		return {"source_path": direct_source_path, "ambiguous": false}
	if basename_map is Dictionary and (basename_map as Dictionary).has(basename):
		var matches = (basename_map as Dictionary)[basename]
		if matches is Array and !matches.is_empty():
			return {"source_path": _pick_preferred_source_match(matches, _tokenize_card_match_key(original_basename)), "ambiguous": false}
	var basename_tail = basename.get_slice(".", basename.get_slice_count(".") - 1).to_lower()
	var original_basename_tail = original_basename.get_slice(".", original_basename.get_slice_count(".") - 1)
	if basename_tail != "" and basename_map is Dictionary and (basename_map as Dictionary).has(basename_tail):
		var tail_matches = (basename_map as Dictionary)[basename_tail]
		if tail_matches is Array and !tail_matches.is_empty():
			return {"source_path": _pick_preferred_source_match(tail_matches, _tokenize_card_match_key(original_basename_tail)), "ambiguous": false}
	var direct_snake_tail = _camel_to_snake_case_match_key(original_basename_tail)
	if direct_snake_tail != "" and basename_map is Dictionary and (basename_map as Dictionary).has(direct_snake_tail):
		var direct_tail_matches = (basename_map as Dictionary)[direct_snake_tail]
		if direct_tail_matches is Array and !direct_tail_matches.is_empty():
			return {"source_path": _pick_preferred_source_match(direct_tail_matches, _tokenize_card_match_key(direct_snake_tail)), "ambiguous": false}
	var direct_snake_full = _camel_to_snake_case_match_key(original_basename)
	if direct_snake_full != "" and basename_map is Dictionary and (basename_map as Dictionary).has(direct_snake_full):
		var direct_full_matches = (basename_map as Dictionary)[direct_snake_full]
		if direct_full_matches is Array and !direct_full_matches.is_empty():
			return {"source_path": _pick_preferred_source_match(direct_full_matches, _tokenize_card_match_key(direct_snake_full)), "ambiguous": false}
	var snake_case_candidates: Array = []
	snake_case_candidates.append(_camel_to_snake_case_match_key(original_basename))
	if original_basename_tail != "" and original_basename_tail.to_lower() != original_basename.to_lower():
		snake_case_candidates.append(_camel_to_snake_case_match_key(original_basename_tail))
	for candidate_basename in snake_case_candidates:
		if candidate_basename == "":
			continue
		if basename_map is Dictionary and (basename_map as Dictionary).has(candidate_basename):
			var snake_matches = (basename_map as Dictionary)[candidate_basename]
			if snake_matches is Array and snake_matches.size() == 1:
				return {"source_path": snake_matches[0], "ambiguous": false}
			if snake_matches is Array and snake_matches.size() > 1:
				return {"source_path": "", "ambiguous": true}
	var normalized_candidates: Array = []
	normalized_candidates.append(_normalize_card_match_key(basename))
	if basename_tail != "" and basename_tail != basename:
		normalized_candidates.append(_normalize_card_match_key(basename_tail))
	for candidate_basename in snake_case_candidates:
		if candidate_basename != "":
			normalized_candidates.append(_normalize_card_match_key(candidate_basename))
	for candidate_key in normalized_candidates:
		if candidate_key == "":
			continue
		if normalized_map is Dictionary and (normalized_map as Dictionary).has(candidate_key):
			var normalized_matches = (normalized_map as Dictionary)[candidate_key]
			if normalized_matches is Array and normalized_matches.size() == 1:
				return {"source_path": normalized_matches[0], "ambiguous": false}
			if normalized_matches is Array and normalized_matches.size() > 1:
				return {"source_path": "", "ambiguous": true}
	var token_candidates: Array = []
	token_candidates.append_array(_tokenize_card_match_key(original_basename))
	token_candidates.append_array(_tokenize_card_match_key(original_basename_tail))
	for candidate_basename in snake_case_candidates:
		token_candidates.append_array(_tokenize_card_match_key(candidate_basename))
	var best_score := 0.0
	var best_source_path := ""
	var best_count := 0
	if sources is Array:
		for source_entry in sources:
			if !(source_entry is Dictionary):
				continue
			var source_tokens = source_entry.get("tokens", [])
			if !(source_tokens is Array):
				continue
			var score = _compute_token_match_score(token_candidates, source_tokens)
			if score > best_score + 0.001:
				best_score = score
				best_source_path = String((source_entry as Dictionary).get("source_path", ""))
				best_count = 1
			elif abs(score - best_score) <= 0.001 and score > 0.0:
				best_count += 1
	if best_score >= 0.99 and best_count == 1:
		return {"source_path": best_source_path, "ambiguous": false}
	if best_score >= 0.99 and best_count > 1:
		return {"source_path": "", "ambiguous": true}
	return {"source_path": "", "ambiguous": false}


func _pick_preferred_source_match(matches: Array, preferred_tokens: Array) -> String:
	if matches.is_empty():
		return ""
	var best_path = String(matches[0])
	var best_score := -1000
	for match_path in matches:
		var path = String(match_path)
		var score := 0
		if path.find("/beta/") < 0:
			score += 10
		for token in preferred_tokens:
			if path.to_lower().find("/%s/" % String(token).to_lower()) >= 0:
				score += 5
		if score > best_score:
			best_score = score
			best_path = path
	return best_path


func _resolve_source_path_from_basename(basename: String) -> String:
	if basename == "":
		return ""
	var direct_candidates: Array = []
	direct_candidates.append("%s%s.png" % [MANAGED_TEXTURE_PREFIX, basename])
	for folder in CARD_PORTRAIT_FOLDERS:
		direct_candidates.append("%s%s/%s.png" % [MANAGED_TEXTURE_PREFIX, folder, basename])
		direct_candidates.append("%s%s/beta/%s.png" % [MANAGED_TEXTURE_PREFIX, folder, basename])
	for candidate in direct_candidates:
		if ResourceLoader.exists(String(candidate)):
			return String(candidate)
	return ""


func _normalize_card_match_key(value: String) -> String:
	var lower_value = value.to_lower()
	var result = ""
	for index in range(lower_value.length()):
		var char_code = lower_value.unicode_at(index)
		var is_digit = char_code >= 48 and char_code <= 57
		var is_lower = char_code >= 97 and char_code <= 122
		if is_digit or is_lower:
			result += char(lower_value.unicode_at(index))
	return result


func _camel_to_snake_case_match_key(value: String) -> String:
	if value == "":
		return ""
	var source = value.replace("-", "_").replace(" ", "_")
	var result = ""
	for index in range(source.length()):
		var character = source.substr(index, 1)
		var char_code = source.unicode_at(index)
		var is_upper = char_code >= 65 and char_code <= 90
		var is_lower = char_code >= 97 and char_code <= 122
		var is_digit = char_code >= 48 and char_code <= 57
		if character == ".":
			result += "_"
			continue
		if character == "_":
			if !result.ends_with("_"):
				result += "_"
			continue
		if is_upper:
			var previous_is_word = index > 0 and (source.unicode_at(index - 1) >= 97 and source.unicode_at(index - 1) <= 122 or source.unicode_at(index - 1) >= 48 and source.unicode_at(index - 1) <= 57)
			var next_is_lower = index + 1 < source.length() and (source.unicode_at(index + 1) >= 97 and source.unicode_at(index + 1) <= 122)
			if result != "" and !result.ends_with("_") and (previous_is_word or next_is_lower):
				result += "_"
			result += character.to_lower()
			continue
		if is_lower or is_digit:
			result += character
			continue
	if result.begins_with("_"):
		result = result.trim_prefix("_")
	while result.find("__") >= 0:
		result = result.replace("__", "_")
	return result.trim_suffix("_")


func _tokenize_card_match_key(value: String) -> Array:
	var snake = _camel_to_snake_case_match_key(value)
	if snake == "":
		return []
	var token_map := {}
	for token in snake.split("_", false):
		var clean = String(token).strip_edges().to_lower()
		if clean != "":
			token_map[clean] = true
	return token_map.keys()


func _compute_token_match_score(candidate_tokens: Array, source_tokens: Array) -> float:
	if candidate_tokens.is_empty() or source_tokens.is_empty():
		return 0.0
	var candidate_map := {}
	for token in candidate_tokens:
		var text = String(token).strip_edges().to_lower()
		if text != "":
			candidate_map[text] = true
	var source_map := {}
	for token in source_tokens:
		var text = String(token).strip_edges().to_lower()
		if text != "":
			source_map[text] = true
	if candidate_map.is_empty() or source_map.is_empty():
		return 0.0
	var intersection := 0
	for token in candidate_map.keys():
		if source_map.has(token):
			intersection += 1
	var denominator = max(candidate_map.size(), source_map.size())
	return float(intersection) / float(denominator) if denominator > 0 else 0.0


func save_override_from_file(source_path: String, import_path: String) -> Dictionary:
	if import_path.strip_edges() == "":
		return {
			"ok": false,
			"message": "No file path was received from the file browser."
		}
	var extension = import_path.get_extension().to_lower()
	if extension == "gif":
		return save_gif_override_from_file(source_path, import_path)
	var image = load_image_from_file(import_path)
	if image == null:
		return {
			"ok": false,
			"message": "Could not load the selected image. Some PNG/JPG files use an encoding Godot rejects. Re-save the image in Paint or another editor and try again.\nPath: %s" % import_path
	}
	return save_override_image(source_path, image)


func export_bundle_to_file(export_path: String) -> Dictionary:
	if _manifest.is_empty():
		return {
			"ok": false,
			"message": "There are no custom card images to export yet."
		}

	var overrides: Array = []
	for source_path in _manifest.keys():
		var entry = _manifest[source_path]
		if !(entry is Dictionary):
			continue
		var bundle_entry = {
			"source_path": source_path,
			"width": int(entry.get("width", 0)),
			"height": int(entry.get("height", 0)),
			"updated_at": String(entry.get("updated_at", "")),
			"type": String(entry.get("type", "static")),
			"display_mode": String(entry.get("display_mode", DISPLAY_MODE_DEFAULT))
		}
		if _is_animated_entry(entry):
			var frame_paths = entry.get("frame_paths", [])
			var frame_delays = entry.get("frame_delays", [])
			var frames: Array = []
			for index in range(frame_paths.size()):
				var frame_path = String(frame_paths[index])
				var absolute_frame_path = ProjectSettings.globalize_path(frame_path)
				var image_bytes = FileAccess.get_file_as_bytes(absolute_frame_path)
				if image_bytes.is_empty():
					continue
				frames.append({
					"png_base64": Marshalls.raw_to_base64(image_bytes),
					"delay": float(frame_delays[index]) if index < frame_delays.size() else 0.1
				})
			if frames.is_empty():
				continue
			bundle_entry["frames"] = frames
		else:
			if !entry.has("override_path"):
				continue
			var override_path = String(entry["override_path"])
			var absolute_override_path = ProjectSettings.globalize_path(override_path)
			var image_bytes = FileAccess.get_file_as_bytes(absolute_override_path)
			if image_bytes.is_empty():
				continue
			bundle_entry["png_base64"] = Marshalls.raw_to_base64(image_bytes)
		overrides.append(bundle_entry)

	if overrides.is_empty():
		return {
			"ok": false,
			"message": "The custom images could not be collected for export."
		}

	var normalized_export_path = export_path
	if !normalized_export_path.to_lower().ends_with(".cardartpack.json"):
		normalized_export_path += ".cardartpack.json"

	var file = FileAccess.open(normalized_export_path, FileAccess.WRITE)
	if file == null:
		return {
			"ok": false,
			"message": "The art pack file could not be created."
		}

	file.store_string(JSON.stringify({
		"format": "card_art_bundle",
		"version": BUNDLE_VERSION,
		"exported_at": Time.get_datetime_string_from_system(),
		"count": overrides.size(),
		"overrides": overrides
	}, "\t"))

	return {
		"ok": true,
		"message": "Exported %d custom card images into one shareable art pack." % overrides.size()
	}


func import_bundle_from_file(import_path: String) -> Dictionary:
	var normalized_import_path = import_path
	if !normalized_import_path.is_absolute_path():
		normalized_import_path = ProjectSettings.globalize_path(import_path)

	var file = FileAccess.open(normalized_import_path, FileAccess.READ)
	if file == null:
		return {
			"ok": false,
			"message": "The selected art pack could not be opened."
		}

	var parsed = JSON.parse_string(file.get_as_text())
	if !(parsed is Dictionary):
		return {
			"ok": false,
			"message": "The selected file is not a valid art pack."
		}

	if String(parsed.get("format", "")) != "card_art_bundle":
		return {
			"ok": false,
			"message": "The selected file is not a supported card art bundle."
		}

	var overrides = parsed.get("overrides", [])
	if !(overrides is Array) or overrides.is_empty():
		return {
			"ok": false,
			"message": "The art pack does not contain any card images."
		}

	var imported_count := 0
	for override_entry in overrides:
		if !(override_entry is Dictionary):
			continue
		var source_path = String(override_entry.get("source_path", ""))
		if source_path == "":
			continue
		if override_entry.has("frames"):
			var frames = override_entry.get("frames", [])
			if !(frames is Array) or frames.is_empty():
				continue
			var imported_images: Array = []
			var imported_delays: Array = []
			for frame_entry in frames:
				if !(frame_entry is Dictionary):
					continue
				var png_base64 = String(frame_entry.get("png_base64", ""))
				if png_base64 == "":
					continue
				var image_bytes = Marshalls.base64_to_raw(png_base64)
				if image_bytes.is_empty():
					continue
				var image = Image.new()
				if image.load_png_from_buffer(image_bytes) != OK:
					continue
				imported_images.append(image)
				imported_delays.append(float(frame_entry.get("delay", 0.1)))
			var animated_result = save_animated_override_images(
				source_path,
				imported_images,
				imported_delays,
				String(override_entry.get("display_mode", DISPLAY_MODE_DEFAULT))
			)
			if bool(animated_result.get("ok", false)):
				imported_count += 1
		else:
			var png_base64 = String(override_entry.get("png_base64", ""))
			if png_base64 == "":
				continue
			var image_bytes = Marshalls.base64_to_raw(png_base64)
			if image_bytes.is_empty():
				continue
			var image = Image.new()
			if image.load_png_from_buffer(image_bytes) != OK:
				continue
			var result = save_override_image(
				source_path,
				image,
				String(override_entry.get("display_mode", DISPLAY_MODE_DEFAULT))
			)
			if bool(result.get("ok", false)):
				imported_count += 1

	if imported_count == 0:
		return {
			"ok": false,
			"message": "No card images from the art pack could be imported."
		}

	refresh_all_portraits()
	return {
		"ok": true,
		"message": "Imported %d card images from the shared art pack." % imported_count
	}


func import_mod_images_from_path(import_path: String) -> Dictionary:
	if import_path.strip_edges() == "":
		return {
			"ok": false,
			"message": "No mod path was selected."
		}

	var import_extension = import_path.get_extension().to_lower()
	var is_direct_pck = import_extension == "pck"
	var mod_root = import_path if DirAccess.dir_exists_absolute(import_path) else import_path.get_base_dir()
	if !DirAccess.dir_exists_absolute(mod_root):
		return {
			"ok": false,
			"message": "The selected mod folder could not be found."
		}

	var selected_name = import_path.get_file().to_lower()
	var has_pck_declared = false
	var mod_id = ""
	var direct_pck_path = import_path if is_direct_pck and FileAccess.file_exists(import_path) else ""
	if selected_name.ends_with(".json"):
		var manifest_file = FileAccess.open(import_path, FileAccess.READ)
		if manifest_file != null:
			var parsed = JSON.parse_string(manifest_file.get_as_text())
			if parsed is Dictionary:
				has_pck_declared = bool((parsed as Dictionary).get("has_pck", false))
				mod_id = String((parsed as Dictionary).get("id", "")).strip_edges()

	var source_index = _build_card_source_index()
	if source_index.is_empty():
		return {
			"ok": false,
			"message": "Could not build the card source index."
		}

	var image_paths: Array = []
	if !is_direct_pck:
		_collect_mod_image_paths(mod_root, image_paths)
	var extracted_temp_dir = ""
	var extracted_saved_dir = ""
	var extract_save_notice = ""
	var extract_debug := {}
	if image_paths.is_empty() and (has_pck_declared or direct_pck_path != ""):
		var pck_path = direct_pck_path if direct_pck_path != "" else _resolve_mod_pck_path(mod_root, mod_id, import_path)
		if pck_path != "":
			var extract_result = _extract_pck_images(pck_path)
			if bool(extract_result.get("ok", false)):
				extracted_temp_dir = String(extract_result.get("temp_dir", ""))
				extracted_saved_dir = String(extract_result.get("saved_dir", extracted_temp_dir))
				extract_save_notice = String(extract_result.get("save_notice", ""))
				extract_debug = _read_extract_metadata(extracted_temp_dir)
				_collect_mod_image_paths(extracted_temp_dir, image_paths)
			elif String(extract_result.get("message", "")) != "":
				return extract_result
	if image_paths.is_empty():
		var debug_suffix = ""
		if !extract_debug.is_empty():
			debug_suffix = " PCK debug: entries=%d, candidates=%d, exported=%d, saved_dir=%s." % [
				int(extract_debug.get("entry_count", 0)),
				int(extract_debug.get("candidate_count", 0)),
				int(extract_debug.get("count", 0)),
				String(extract_debug.get("saved_dir", extracted_saved_dir))
			]
		return {
			"ok": false,
			"message": "No card image files were found in that mod folder or PCK.%s%s" % [
				debug_suffix,
				"%s%s" % [
					" Extracted files folder: %s." % extracted_saved_dir if extracted_saved_dir != "" else "",
					" %s" % extract_save_notice if extract_save_notice != "" else ""
				]
			]
		}

	var imported_count := 0
	var ambiguous_count := 0
	var unmatched_count := 0
	var imported_sources := {}
	var debug_matches: Array = []
	for image_path in image_paths:
		var match = _match_card_source_for_mod_image(String(image_path), source_index)
		if bool(match.get("ambiguous", false)):
			ambiguous_count += 1
			if debug_matches.size() < 10:
				debug_matches.append("%s -> AMBIGUOUS" % String(image_path).get_file())
			continue
		var source_path = String(match.get("source_path", ""))
		if source_path == "":
			unmatched_count += 1
			if debug_matches.size() < 10:
				debug_matches.append("%s -> NO_MATCH" % String(image_path).get_file())
			continue
		if imported_sources.has(source_path):
			if debug_matches.size() < 10:
				debug_matches.append("%s -> DUPLICATE %s" % [String(image_path).get_file(), source_path.get_file()])
			continue
		if debug_matches.size() < 10:
			debug_matches.append("%s -> %s" % [String(image_path).get_file(), source_path.get_file()])
		var result = save_override_from_file(source_path, String(image_path))
		if bool(result.get("ok", false)):
			imported_sources[source_path] = true
			imported_count += 1

	if imported_count == 0:
		return {
			"ok": false,
			"message": "No matching card images were imported from that mod. Unmatched: %d, ambiguous: %d.%s" % [
				unmatched_count,
				ambiguous_count,
				"%s%s" % [
					" Extracted files saved to: %s" % extracted_saved_dir if extracted_saved_dir != "" else " Import source: direct PCK mode.",
					" %s" % extract_save_notice if extract_save_notice != "" else ""
				]
			] + ("\nMatches:\n%s" % "\n".join(debug_matches) if !debug_matches.is_empty() else "")
		}

	return {
		"ok": true,
		"message": "Imported %d card images from the selected mod folder. Unmatched: %d, ambiguous: %d.%s" % [
			imported_count,
			unmatched_count,
			ambiguous_count,
			"%s%s" % [
				" Extracted files saved to: %s" % extracted_saved_dir if extracted_saved_dir != "" else " Import source: direct PCK mode.",
				" %s" % extract_save_notice if extract_save_notice != "" else ""
			]
		] + ("\nMatches:\n%s" % "\n".join(debug_matches) if !debug_matches.is_empty() else "")
	}


func _read_extract_metadata(temp_dir: String) -> Dictionary:
	if temp_dir == "":
		return {}
	var metadata_path = temp_dir.path_join("metadata.json")
	var metadata_file = FileAccess.open(metadata_path, FileAccess.READ)
	if metadata_file == null:
		return {}
	var parsed = JSON.parse_string(metadata_file.get_as_text())
	return parsed if parsed is Dictionary else {}


func save_override_image(source_path: String, image, display_mode: String = DISPLAY_MODE_DEFAULT) -> Dictionary:
	if source_path == "":
		return {
			"ok": false,
			"message": "No source card art is selected."
		}
	if image == null:
		return {
			"ok": false,
			"message": "No image data was provided."
		}

	var normalized_image = normalize_image(image, get_target_size_for_source_path(source_path))
	if normalized_image == null:
		return {
			"ok": false,
			"message": "The image could not be converted to the card art format."
		}
	return _save_static_override_data(source_path, normalized_image, image, 1.0, 0.0, 0.0, display_mode)


func save_adjusted_override(source_path: String, zoom: float, offset_x: float, offset_y: float) -> Dictionary:
	var payload = get_adjustable_override_payload(source_path)
	if payload.is_empty():
		return {
			"ok": false,
			"message": "The current custom image cannot be adjusted."
		}

	if String(payload.get("type", "static")) == "animated_gif":
		var source_images = payload.get("images", [])
		var delays = payload.get("delays", [])
		if !(source_images is Array) or source_images.is_empty():
			return {
				"ok": false,
				"message": "The current GIF could not be adjusted."
			}
		var adjusted_images: Array = []
		for source_image in source_images:
			var adjusted_frame = build_adjusted_preview(source_path, source_image, zoom, offset_x, offset_y)
			if adjusted_frame == null:
				continue
			adjusted_images.append(adjusted_frame)
		if adjusted_images.is_empty():
			return {
				"ok": false,
				"message": "The adjusted GIF frames could not be generated."
			}
		var result = save_animated_override_images(source_path, adjusted_images, delays, get_display_mode(source_path))
		if bool(result.get("ok", false)):
			var entry = _manifest.get(source_path, null)
			if entry is Dictionary:
				entry["adjust_zoom"] = zoom
				entry["adjust_offset_x"] = offset_x
				entry["adjust_offset_y"] = offset_y
				_manifest[source_path] = entry
				_save_manifest()
		return result

	var source_image = payload.get("image", null)
	var adjusted_image = build_adjusted_preview(source_path, source_image, zoom, offset_x, offset_y)
	if adjusted_image == null:
		return {
			"ok": false,
			"message": "The adjusted image could not be generated."
		}

	return _save_static_override_data(source_path, adjusted_image, source_image, zoom, offset_x, offset_y, get_display_mode(source_path))


func build_adjusted_preview(source_path: String, source_image, zoom: float, offset_x: float, offset_y: float):
	if source_image == null:
		return null
	if is_full_art_mode(source_path):
		var prepared_image = trim_transparent_margins(source_image)
		if prepared_image == null:
			return null
		return normalize_image_with_adjustment(
			prepared_image,
			FULL_ART_TARGET_SIZE,
			float(zoom) * FULL_ART_STATIC_ZOOM_BOOST,
			offset_x,
			offset_y
		)
	var target_size = get_target_size_for_source_path(source_path)
	return normalize_image_with_adjustment(source_image, target_size, zoom, offset_x, offset_y)


func save_gif_override_from_file(source_path: String, import_path: String, display_mode: String = DISPLAY_MODE_DEFAULT) -> Dictionary:
	if source_path == "":
		return {
			"ok": false,
			"message": "No source card art is selected."
		}

	var extract_result = _extract_gif_frames(import_path)
	if !bool(extract_result.get("ok", false)):
		return extract_result

	var save_result = save_animated_override_images(
		source_path,
		Array(extract_result.get("images", [])),
		Array(extract_result.get("delays", [])),
		display_mode
	)
	var temp_dir = String(extract_result.get("temp_dir", ""))
	if temp_dir != "":
		_delete_directory_recursive(temp_dir)
	return save_result


func save_animated_override_images(source_path: String, images: Array, delays: Array, display_mode: String = DISPLAY_MODE_DEFAULT) -> Dictionary:
	if source_path == "":
		return {
			"ok": false,
			"message": "No source card art is selected."
		}
	if images.is_empty():
		return {
			"ok": false,
			"message": "The GIF did not contain any readable frames."
		}

	var target_size = get_target_size_for_source_path(source_path)
	var safe_stem = _safe_file_stem(source_path)
	var frame_paths: Array = []
	var source_frame_paths: Array = []
	var frame_delays: Array = []

	_remove_entry_files(_manifest.get(source_path, null))

	for index in range(images.size()):
		var source_image = images[index]
		var normalized_image = normalize_image(source_image, target_size)
		if normalized_image == null:
			continue
		var frame_path = "%s/%s_anim_%03d.png" % [STORAGE_IMAGE_DIR, safe_stem, index]
		var source_frame_path = "%s/%s_anim_source_%03d.png" % [STORAGE_EDIT_SOURCE_DIR, safe_stem, index]
		var absolute_frame_path = ProjectSettings.globalize_path(frame_path)
		var absolute_source_frame_path = ProjectSettings.globalize_path(source_frame_path)
		var save_error = normalized_image.save_png(absolute_frame_path)
		if save_error != OK:
			continue
		if source_image != null and source_image.save_png(absolute_source_frame_path) == OK:
			source_frame_paths.append(source_frame_path)
		else:
			source_frame_paths.append(frame_path)
		frame_paths.append(frame_path)
		frame_delays.append(max(0.02, float(delays[index]) if index < delays.size() else 0.1))

	if frame_paths.is_empty():
		return {
			"ok": false,
			"message": "The GIF frames could not be converted to card art."
		}

	_manifest[source_path] = {
		"type": "animated_gif",
		"frame_paths": frame_paths,
		"source_frame_paths": source_frame_paths,
		"frame_delays": frame_delays,
		"width": target_size.x,
		"height": target_size.y,
		"display_mode": display_mode,
		"updated_at": Time.get_datetime_string_from_system()
	}
	_override_texture_cache.erase(source_path)
	_save_manifest()
	refresh_all_portraits()
	overrides_changed.emit(source_path)

	return {
		"ok": true,
		"message": "Animated GIF applied with %d frames." % frame_paths.size()
	}


func _save_static_override_data(source_path: String, normalized_image, edit_source_image, zoom: float, offset_x: float, offset_y: float, display_mode: String = DISPLAY_MODE_DEFAULT) -> Dictionary:
	var target_size = get_target_size_for_source_path(source_path)
	var safe_stem = _safe_file_stem(source_path)
	var override_path = "%s/%s.png" % [STORAGE_IMAGE_DIR, safe_stem]
	var edit_source_path = "%s/%s_source.png" % [STORAGE_EDIT_SOURCE_DIR, safe_stem]
	var absolute_override_path = ProjectSettings.globalize_path(override_path)
	var absolute_edit_source_path = ProjectSettings.globalize_path(edit_source_path)

	_remove_entry_files(_manifest.get(source_path, null))

	if normalized_image.save_png(absolute_override_path) != OK:
		return {
			"ok": false,
			"message": "Failed to save the converted card art."
		}

	var edit_image_to_save = edit_source_image if edit_source_image != null else normalized_image
	if edit_image_to_save.save_png(absolute_edit_source_path) != OK:
		return {
			"ok": false,
			"message": "Failed to save the adjustable source image."
		}

	_manifest[source_path] = {
		"override_path": override_path,
		"edit_source_path": edit_source_path,
		"width": target_size.x,
		"height": target_size.y,
		"display_mode": display_mode,
		"adjust_zoom": zoom,
		"adjust_offset_x": offset_x,
		"adjust_offset_y": offset_y,
		"updated_at": Time.get_datetime_string_from_system()
	}
	_override_texture_cache.erase(source_path)
	_save_manifest()
	refresh_all_portraits()
	overrides_changed.emit(source_path)

	return {
		"ok": true,
		"message": "Custom art applied and resized to %dx%d." % [target_size.x, target_size.y]
	}


func remove_override(source_path: String) -> Dictionary:
	if !_manifest.has(source_path):
		return {
			"ok": false,
			"message": "This card is already using its original art."
		}

	_remove_entry_files(_manifest[source_path])

	_manifest.erase(source_path)
	_override_texture_cache.erase(source_path)
	_save_manifest()
	refresh_all_portraits()
	overrides_changed.emit(source_path)

	return {
		"ok": true,
		"message": "Restored the original card art."
	}


func remove_all_overrides() -> Dictionary:
	if _manifest.is_empty():
		return {
			"ok": false,
			"message": "All cards are already using their original art."
		}

	for source_path in _manifest.keys():
		_remove_entry_files(_manifest[source_path])

	_manifest.clear()
	_override_texture_cache.clear()
	_save_manifest()
	refresh_all_portraits()

	return {
		"ok": true,
		"message": "Restored all card art to the original images."
	}


func load_image_from_file(path: String):
	var image = Image.new()
	var normalized_path = path
	if !path.is_absolute_path():
		normalized_path = ProjectSettings.globalize_path(path)

	var direct_load_error = image.load(normalized_path)
	if direct_load_error == OK:
		return image

	var image_bytes = FileAccess.get_file_as_bytes(normalized_path)
	if image_bytes.is_empty():
		return null

	var extension = normalized_path.get_extension().to_lower()
	var load_error = ERR_FILE_UNRECOGNIZED
	var fallback_attempts = []

	match extension:
		"png":
			load_error = image.load_png_from_buffer(image_bytes)
			fallback_attempts = [
				func (): return image.load_jpg_from_buffer(image_bytes),
				func (): return image.load_webp_from_buffer(image_bytes)
			]
		"jpg", "jpeg":
			load_error = image.load_jpg_from_buffer(image_bytes)
			fallback_attempts = [
				func (): return image.load_png_from_buffer(image_bytes),
				func (): return image.load_webp_from_buffer(image_bytes)
			]
		"webp":
			load_error = image.load_webp_from_buffer(image_bytes)
			fallback_attempts = [
				func (): return image.load_png_from_buffer(image_bytes),
				func (): return image.load_jpg_from_buffer(image_bytes)
			]
		_:
			return null

	if load_error != OK:
		for attempt in fallback_attempts:
			load_error = attempt.call()
			if load_error == OK:
				break
		if load_error != OK:
			return null

	return image


func load_first_gif_frame(path: String):
	var extract_result = _extract_gif_frames(path)
	if !bool(extract_result.get("ok", false)):
		return null
	var images = extract_result.get("images", [])
	var temp_dir = String(extract_result.get("temp_dir", ""))
	if temp_dir != "":
		_delete_directory_recursive(temp_dir)
	if images is Array and !images.is_empty():
		return images[0]
	return null


func _extract_gif_frames(import_path: String) -> Dictionary:
	var tool_path = _ensure_gif_tool_script()
	if tool_path == "":
		return {
			"ok": false,
			"message": "The bundled GIF extraction tool could not be prepared."
		}

	var normalized_import_path = import_path
	if !normalized_import_path.is_absolute_path():
		normalized_import_path = ProjectSettings.globalize_path(import_path)

	var output_dir = ProjectSettings.globalize_path("%s/%s_%d" % [
		STORAGE_GIF_TEMP_DIR,
		_safe_file_stem(import_path.get_file()),
		Time.get_ticks_msec()
	])
	DirAccess.make_dir_recursive_absolute(output_dir)

	var command_output: Array = []
	var exit_code = OS.execute(
		"powershell.exe",
		[
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			tool_path,
			"-InputPath",
			normalized_import_path,
			"-OutputDir",
			output_dir
		],
		command_output,
		true
	)
	if exit_code != 0:
		return {
			"ok": false,
			"message": "GIF frame extraction failed.\n%s" % "\n".join(command_output)
		}

	var metadata_path = output_dir.path_join("metadata.json")
	var metadata_file = FileAccess.open(metadata_path, FileAccess.READ)
	if metadata_file == null:
		return {
			"ok": false,
			"message": "GIF extraction did not produce metadata."
		}

	var parsed = JSON.parse_string(metadata_file.get_as_text())
	if !(parsed is Dictionary):
		return {
			"ok": false,
			"message": "GIF extraction metadata was invalid."
		}

	var frame_files = parsed.get("frames", [])
	var frame_delays = parsed.get("delays", [])
	if !(frame_files is Array) or frame_files.is_empty():
		return {
			"ok": false,
			"message": "The GIF did not produce any frames."
		}

	var images: Array = []
	var delays: Array = []
	for index in range(frame_files.size()):
		var frame_file = String(frame_files[index])
		var frame_image = load_image_from_file(frame_file)
		if frame_image == null:
			continue
		images.append(frame_image)
		delays.append(max(0.02, float(frame_delays[index]) if index < frame_delays.size() else 0.1))

	if images.is_empty():
		return {
			"ok": false,
			"message": "The extracted GIF frames could not be loaded."
		}

	return {
		"ok": true,
		"images": images,
		"delays": delays,
		"temp_dir": output_dir
	}


func _ensure_gif_tool_script() -> String:
	var source_file = FileAccess.open(GIF_TOOL_RES_PATH, FileAccess.READ)
	if source_file == null:
		return ""
	var script_text = source_file.get_as_text()
	var absolute_tool_path = ProjectSettings.globalize_path(GIF_TOOL_USER_PATH)
	DirAccess.make_dir_recursive_absolute(absolute_tool_path.get_base_dir())
	var existing_text = ""
	if FileAccess.file_exists(absolute_tool_path):
		var existing_file = FileAccess.open(absolute_tool_path, FileAccess.READ)
		if existing_file != null:
			existing_text = existing_file.get_as_text()
	if existing_text != script_text:
		var tool_file = FileAccess.open(absolute_tool_path, FileAccess.WRITE)
		if tool_file == null:
			return ""
		tool_file.store_string(script_text)
	return absolute_tool_path


func _is_animated_entry(entry) -> bool:
	return entry is Dictionary and entry.has("frame_paths")


func _remove_entry_files(entry) -> void:
	if !(entry is Dictionary):
		return
	if _is_animated_entry(entry):
		for frame_path in entry.get("frame_paths", []):
			var absolute_frame_path = ProjectSettings.globalize_path(String(frame_path))
			if FileAccess.file_exists(absolute_frame_path):
				DirAccess.remove_absolute(absolute_frame_path)
		for source_frame_path in entry.get("source_frame_paths", []):
			var absolute_source_frame_path = ProjectSettings.globalize_path(String(source_frame_path))
			if FileAccess.file_exists(absolute_source_frame_path):
				DirAccess.remove_absolute(absolute_source_frame_path)
		return
	if entry.has("override_path"):
		var absolute_override_path = ProjectSettings.globalize_path(String(entry["override_path"]))
		if FileAccess.file_exists(absolute_override_path):
			DirAccess.remove_absolute(absolute_override_path)
	if entry.has("edit_source_path"):
		var absolute_edit_source_path = ProjectSettings.globalize_path(String(entry["edit_source_path"]))
		if FileAccess.file_exists(absolute_edit_source_path):
			DirAccess.remove_absolute(absolute_edit_source_path)


func _delete_directory_recursive(path: String) -> void:
	var dir = DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	while true:
		var entry_name = dir.get_next()
		if entry_name == "":
			break
		if entry_name == "." or entry_name == "..":
			continue
		var entry_path = path.path_join(entry_name)
		if dir.current_is_dir():
			_delete_directory_recursive(entry_path)
		else:
			DirAccess.remove_absolute(entry_path)
	dir.list_dir_end()
	DirAccess.remove_absolute(path)


func normalize_image(image, target_size: Vector2i):
	return normalize_image_with_adjustment(image, target_size, 1.0, 0.0, 0.0)


func normalize_image_with_adjustment(image, target_size: Vector2i, zoom: float, offset_x: float, offset_y: float):
	var working_image = image.duplicate()
	if working_image.is_compressed():
		var decompress_error = working_image.decompress()
		if decompress_error != OK:
			return null
	working_image.convert(Image.FORMAT_RGBA8)

	var scale_x = float(target_size.x) / float(max(working_image.get_width(), 1))
	var scale_y = float(target_size.y) / float(max(working_image.get_height(), 1))
	var scale_factor = max(scale_x, scale_y) * max(1.0, zoom)

	var resized_width = max(target_size.x, int(round(working_image.get_width() * scale_factor)))
	var resized_height = max(target_size.y, int(round(working_image.get_height() * scale_factor)))
	working_image.resize(resized_width, resized_height, Image.INTERPOLATE_LANCZOS)

	var extra_width = max(0, resized_width - target_size.x)
	var extra_height = max(0, resized_height - target_size.y)
	var crop_x = clamp(int(round(extra_width * 0.5 + (clamp(offset_x, -1.0, 1.0) * extra_width * 0.5))), 0, extra_width)
	var crop_y = clamp(int(round(extra_height * 0.5 + (clamp(offset_y, -1.0, 1.0) * extra_height * 0.5))), 0, extra_height)
	var normalized_image = Image.create(target_size.x, target_size.y, false, Image.FORMAT_RGBA8)
	normalized_image.blit_rect(
		working_image,
		Rect2i(crop_x, crop_y, target_size.x, target_size.y),
		Vector2i.ZERO
	)
	return normalized_image


func trim_transparent_margins(image):
	if image == null:
		return null
	var working_image = image.duplicate()
	if working_image.is_compressed():
		var decompress_error = working_image.decompress()
		if decompress_error != OK:
			return image
	working_image.convert(Image.FORMAT_RGBA8)
	var used_rect = working_image.get_used_rect()
	if used_rect.size.x <= 0 or used_rect.size.y <= 0:
		return working_image
	if used_rect.position == Vector2i.ZERO and used_rect.size == Vector2i(working_image.get_width(), working_image.get_height()):
		return working_image
	var trimmed_image = Image.create(used_rect.size.x, used_rect.size.y, false, Image.FORMAT_RGBA8)
	trimmed_image.blit_rect(working_image, used_rect, Vector2i.ZERO)
	return trimmed_image


func build_full_art_preview(source_path: String, source_image, target_size_override: Vector2i = Vector2i.ZERO, zoom_boost: float = FULL_ART_STATIC_ZOOM_BOOST):
	if source_image == null:
		return null
	var target_size = target_size_override
	if target_size.x <= 0 or target_size.y <= 0:
		target_size = FULL_ART_TARGET_SIZE
	var adjustment = get_override_adjustment_state(source_path)
	return normalize_image_with_adjustment(
		source_image,
		target_size,
		float(adjustment.get("zoom", 1.0)) * max(zoom_boost, 1.0),
		float(adjustment.get("offset_x", 0.0)),
		float(adjustment.get("offset_y", 0.0))
	)


func refresh_all_portraits() -> void:
	_refresh_tracked_portraits()


func apply_override_to_texture_rect(texture_rect) -> void:
	if texture_rect == null:
		return
	_refresh_portrait_node(texture_rect)


func _find_named_descendant(node: Node, target_name: String):
	if node == null:
		return null
	for child in node.get_children():
		if String(child.name) == target_name:
			return child
		var nested = _find_named_descendant(child, target_name)
		if nested != null:
			return nested
	return null


func _find_card_root(texture_rect):
	var current = texture_rect
	while current != null:
		if String(current.name) == "CardContainer":
			return current
		current = current.get_parent()
	return null


func _get_card_rect_size(card_root, fallback_size: Vector2i) -> Vector2i:
	if card_root is Control:
		var control_size = (card_root as Control).size
		if control_size.x > 0.0 and control_size.y > 0.0:
			return Vector2i(int(control_size.x), int(control_size.y))
	return fallback_size


func _configure_full_art_layer(card_root, layer: TextureRect, inset: int = FULL_ART_INSET_STATIC) -> void:
	var reference_node = _find_named_descendant(card_root, "AncientPortrait")
	if reference_node == null:
		reference_node = _find_named_descendant(card_root, "Portrait")
	if reference_node == null:
		reference_node = _find_named_descendant(card_root, "AncientBorder")
	if reference_node == null:
		reference_node = _find_named_descendant(card_root, "AncientHighlight")
	if reference_node is TextureRect:
		var reference := reference_node as TextureRect
		layer.layout_mode = reference.layout_mode
		layer.anchor_left = reference.anchor_left
		layer.anchor_top = reference.anchor_top
		layer.anchor_right = reference.anchor_right
		layer.anchor_bottom = reference.anchor_bottom
		layer.offset_left = reference.offset_left + inset
		layer.offset_top = reference.offset_top + inset
		layer.offset_right = reference.offset_right - inset
		layer.offset_bottom = reference.offset_bottom - inset
		layer.expand_mode = reference.expand_mode
		layer.stretch_mode = reference.stretch_mode
		layer.scale = reference.scale
		layer.pivot_offset = reference.pivot_offset
		layer.rotation = reference.rotation
		layer.clip_contents = false
	else:
		layer.layout_mode = 1
		layer.set_anchors_preset(Control.PRESET_FULL_RECT)
		layer.offset_left = inset
		layer.offset_top = inset
		layer.offset_right = -inset
		layer.offset_bottom = -inset
		layer.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		layer.stretch_mode = TextureRect.STRETCH_SCALE
		layer.scale = Vector2.ONE
		layer.pivot_offset = Vector2.ZERO
		layer.clip_contents = false
	layer.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	layer.texture_repeat = CanvasItem.TEXTURE_REPEAT_DISABLED


func _get_or_create_full_art_layer(card_root, inset: int = FULL_ART_INSET_STATIC):
	if card_root == null:
		return null
	var host = _find_named_descendant(card_root, "PortraitCanvasGroup")
	if host == null:
		host = card_root
	var existing = host.get_node_or_null(FULL_ART_LAYER_NAME)
	if existing is TextureRect:
		_configure_full_art_layer(card_root, existing, inset)
		return existing
	var layer := TextureRect.new()
	layer.name = FULL_ART_LAYER_NAME
	layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_configure_full_art_layer(card_root, layer, inset)
	layer.visible = false
	host.add_child(layer)
	host.move_child(layer, 0)
	return layer


func _get_full_art_layer(card_root):
	if card_root == null:
		return null
	var host = _find_named_descendant(card_root, "PortraitCanvasGroup")
	if host == null:
		host = card_root
	var layer = host.get_node_or_null(FULL_ART_LAYER_NAME)
	return layer if layer is TextureRect else null


func _apply_full_art_portrait_mask(portrait_canvas_group) -> void:
	if !(portrait_canvas_group is CanvasGroup):
		return
	var canvas_group := portrait_canvas_group as CanvasGroup
	if !canvas_group.has_meta(META_PORTRAIT_GROUP_ORIGINAL_MATERIAL):
		canvas_group.set_meta(META_PORTRAIT_GROUP_ORIGINAL_MATERIAL, canvas_group.material)
	canvas_group.visible = true
	canvas_group.material = FULL_ART_MASK_MATERIAL


func _restore_full_art_portrait_mask(portrait_canvas_group) -> void:
	if !(portrait_canvas_group is CanvasGroup):
		return
	var canvas_group := portrait_canvas_group as CanvasGroup
	var original_material = canvas_group.get_meta(META_PORTRAIT_GROUP_ORIGINAL_MATERIAL, null)
	canvas_group.material = original_material if original_material is Material else null
	canvas_group.remove_meta(META_PORTRAIT_GROUP_ORIGINAL_MATERIAL)


func _build_full_art_layer_texture(card_root, source_path: String):
	var entry = _manifest.get(source_path, null)
	if !(entry is Dictionary):
		return null
	if _is_animated_entry(entry):
		var source_frames = entry.get("source_frame_paths", entry.get("frame_paths", []))
		var frame_delays = entry.get("frame_delays", [])
		if !(source_frames is Array) or source_frames.is_empty():
			return null
		var loaded_frames: Array = []
		for index in range(source_frames.size()):
			var source_frame_path = String(source_frames[index])
			var source_frame_image = load_image_from_file(ProjectSettings.globalize_path(source_frame_path))
			if source_frame_image == null:
				continue
			source_frame_image = trim_transparent_margins(source_frame_image)
			var preview_frame = build_full_art_preview(source_path, source_frame_image, Vector2i.ZERO, FULL_ART_ANIMATED_ZOOM_BOOST)
			if preview_frame == null:
				continue
			loaded_frames.append({
				"texture": ImageTexture.create_from_image(preview_frame),
				"delay": max(0.02, float(frame_delays[index]) if index < frame_delays.size() else 0.1)
			})
		if loaded_frames.is_empty():
			return null
		var animated_texture := AnimatedTexture.new()
		animated_texture.frames = loaded_frames.size()
		animated_texture.speed_scale = 1.0
		for index in range(loaded_frames.size()):
			var frame_entry = loaded_frames[index]
			animated_texture.set_frame_texture(index, frame_entry["texture"])
			animated_texture.set_frame_duration(index, frame_entry["delay"])
		return animated_texture
	var source_image_path = String(entry.get("edit_source_path", entry.get("override_path", "")))
	if source_image_path == "":
		return null
	var source_image = load_image_from_file(ProjectSettings.globalize_path(source_image_path))
	if source_image == null:
		return null
	var preview = build_full_art_preview(source_path, source_image)
	if preview == null:
		return null
	return ImageTexture.create_from_image(preview)


func _apply_full_art_state(texture_rect, source_path: String, override_texture) -> bool:
	var card_root = _find_card_root(texture_rect)
	if card_root == null:
		return false
	var entry = _manifest.get(source_path, null)
	var full_art_inset = FULL_ART_INSET_ANIMATED if _is_animated_entry(entry) else FULL_ART_INSET_STATIC
	var full_art_layer = _get_or_create_full_art_layer(card_root, full_art_inset)
	if !(full_art_layer is TextureRect):
		return false
	var portrait_canvas_group = _find_named_descendant(card_root, "PortraitCanvasGroup")
	var ancient_portrait = _find_named_descendant(card_root, "AncientPortrait")
	var ancient_highlight = _find_named_descendant(card_root, "AncientHighlight")
	var portrait_border = _find_named_descendant(card_root, "PortraitBorder")
	var frame = _find_named_descendant(card_root, "Frame")
	var title_banner = _find_named_descendant(card_root, "TitleBanner")
	var ancient_border = _find_named_descendant(card_root, "AncientBorder")
	var ancient_text_bg = _find_named_descendant(card_root, "AncientTextBg")
	var ancient_banner = _find_named_descendant(card_root, "AncientBanner")
	if override_texture == null:
		return false
	var layer = full_art_layer as TextureRect
	var layer_active = bool(layer.get_meta(META_FULL_ART_ACTIVE, false))
	var layer_owner = String(layer.get_meta(META_FULL_ART_OWNER_PATH, ""))
	var already_same = layer_active and layer_owner == source_path and layer.texture == override_texture
	if !already_same:
		layer.texture = override_texture
	layer.visible = true
	layer.set_meta(META_FULL_ART_ACTIVE, true)
	layer.set_meta(META_FULL_ART_OWNER_PATH, source_path)
	texture_rect.visible = false
	texture_rect.self_modulate = Color(1, 1, 1, 0)
	_apply_full_art_portrait_mask(portrait_canvas_group)
	if ancient_portrait is TextureRect:
		(ancient_portrait as TextureRect).visible = false
		(ancient_portrait as TextureRect).self_modulate = Color(1, 1, 1, 0)
	if portrait_border is CanvasItem:
		portrait_border.visible = false
	if frame is CanvasItem:
		frame.visible = false
	if title_banner is CanvasItem:
		title_banner.visible = false
	if ancient_highlight is CanvasItem:
		ancient_highlight.visible = true
	if ancient_border is CanvasItem:
		ancient_border.visible = true
	if ancient_text_bg is CanvasItem:
		ancient_text_bg.visible = true
	if ancient_banner is CanvasItem:
		ancient_banner.visible = true
	texture_rect.set_meta(META_FULL_ART_ACTIVE, true)
	return true


func _clear_custom_full_art_layer(card_root) -> void:
	if card_root == null:
		return
	var portrait_canvas_group = _find_named_descendant(card_root, "PortraitCanvasGroup")
	var full_art_layer = _get_full_art_layer(card_root)
	var portrait = _find_named_descendant(card_root, "Portrait")
	var ancient_portrait = _find_named_descendant(card_root, "AncientPortrait")
	var portrait_border = _find_named_descendant(card_root, "PortraitBorder")
	var frame = _find_named_descendant(card_root, "Frame")
	var title_banner = _find_named_descendant(card_root, "TitleBanner")
	var ancient_highlight = _find_named_descendant(card_root, "AncientHighlight")
	var ancient_border = _find_named_descendant(card_root, "AncientBorder")
	var ancient_text_bg = _find_named_descendant(card_root, "AncientTextBg")
	var ancient_banner = _find_named_descendant(card_root, "AncientBanner")
	var is_ancient_layout = ancient_portrait is CanvasItem and (ancient_portrait as CanvasItem).visible and !(portrait is CanvasItem and (portrait as CanvasItem).visible)

	if full_art_layer is TextureRect:
		full_art_layer.visible = false
		full_art_layer.texture = null
		full_art_layer.set_meta(META_FULL_ART_ACTIVE, false)
		full_art_layer.remove_meta(META_FULL_ART_OWNER_PATH)
	if portrait_canvas_group is CanvasItem:
		portrait_canvas_group.visible = true
	_restore_full_art_portrait_mask(portrait_canvas_group)
	if portrait is TextureRect:
		(portrait as TextureRect).self_modulate = Color(1, 1, 1, 1)
	if ancient_portrait is TextureRect:
		(ancient_portrait as TextureRect).self_modulate = Color(1, 1, 1, 1)
	if is_ancient_layout:
		if portrait_border is CanvasItem:
			portrait_border.visible = false
		if frame is CanvasItem:
			frame.visible = false
		if title_banner is CanvasItem:
			title_banner.visible = false
		if ancient_highlight is CanvasItem:
			ancient_highlight.visible = true
		if ancient_border is CanvasItem:
			ancient_border.visible = true
		if ancient_text_bg is CanvasItem:
			ancient_text_bg.visible = true
		if ancient_banner is CanvasItem:
			ancient_banner.visible = true
	else:
		if portrait_border is CanvasItem:
			portrait_border.visible = true
		if frame is CanvasItem:
			frame.visible = true
		if title_banner is CanvasItem:
			title_banner.visible = true
		if ancient_highlight is CanvasItem:
			ancient_highlight.visible = false
		if ancient_border is CanvasItem:
			ancient_border.visible = false
		if ancient_text_bg is CanvasItem:
			ancient_text_bg.visible = false
		if ancient_banner is CanvasItem:
			ancient_banner.visible = false


func _restore_full_art_state(texture_rect) -> void:
	var card_root = _find_card_root(texture_rect)
	if card_root == null:
		texture_rect.set_meta(META_FULL_ART_ACTIVE, false)
		texture_rect.visible = true
		return
	var portrait_canvas_group = _find_named_descendant(card_root, "PortraitCanvasGroup")
	var full_art_layer = _get_full_art_layer(card_root)
	var portrait = _find_named_descendant(card_root, "Portrait")
	var ancient_portrait = _find_named_descendant(card_root, "AncientPortrait")
	var ancient_highlight = _find_named_descendant(card_root, "AncientHighlight")
	var portrait_border = _find_named_descendant(card_root, "PortraitBorder")
	var frame = _find_named_descendant(card_root, "Frame")
	var title_banner = _find_named_descendant(card_root, "TitleBanner")
	var ancient_border = _find_named_descendant(card_root, "AncientBorder")
	var ancient_text_bg = _find_named_descendant(card_root, "AncientTextBg")
	var ancient_banner = _find_named_descendant(card_root, "AncientBanner")
	if full_art_layer is TextureRect:
		full_art_layer.visible = false
		full_art_layer.texture = null
	if portrait_canvas_group is CanvasItem:
		portrait_canvas_group.visible = true
	_restore_full_art_portrait_mask(portrait_canvas_group)
	if ancient_portrait is TextureRect:
		(ancient_portrait as TextureRect).visible = false
		(ancient_portrait as TextureRect).self_modulate = Color(1, 1, 1, 1)
	if portrait_border is CanvasItem:
		portrait_border.visible = true
	if frame is CanvasItem:
		frame.visible = true
	if title_banner is CanvasItem:
		title_banner.visible = true
	if ancient_highlight is CanvasItem:
		ancient_highlight.visible = false
	if ancient_border is CanvasItem:
		ancient_border.visible = false
	if ancient_text_bg is CanvasItem:
		ancient_text_bg.visible = false
	if ancient_banner is CanvasItem:
		ancient_banner.visible = false
	if portrait is TextureRect:
		(portrait as TextureRect).visible = true
		(portrait as TextureRect).self_modulate = Color(1, 1, 1, 1)
		(portrait as TextureRect).set_meta(META_FULL_ART_ACTIVE, false)
	else:
		texture_rect.visible = true
		texture_rect.set_meta(META_FULL_ART_ACTIVE, false)


func _on_node_added(node) -> void:
	if _is_portrait_node(node):
		_track_portrait(node)
	elif node is Control and String(node.name) == "InspectCardScreen":
		call_deferred("_attach_overlay", node)


func _register_existing(node) -> void:
	if _is_portrait_node(node):
		_track_portrait(node)
	elif node is Control and String(node.name) == "InspectCardScreen":
		call_deferred("_attach_overlay", node)

	for child in node.get_children():
		_register_existing(child)


func _track_portrait(texture_rect) -> void:
	for ref in _portrait_refs:
		if ref.get_ref() == texture_rect:
			return
	_portrait_refs.append(weakref(texture_rect))
	_refresh_portrait_node(texture_rect)


func _refresh_tracked_portraits() -> void:
	for index in range(_portrait_refs.size() - 1, -1, -1):
		var texture_rect = _portrait_refs[index].get_ref()
		if texture_rect == null:
			_portrait_refs.remove_at(index)
			continue
		_refresh_portrait_node(texture_rect)


func _get_card_root_source_path(card_root) -> String:
	if card_root == null:
		return ""
	var ancient_portrait = _find_named_descendant(card_root, "AncientPortrait")
	var portrait = _find_named_descendant(card_root, "Portrait")
	var ancient_visible = ancient_portrait is CanvasItem and (ancient_portrait as CanvasItem).visible
	var portrait_visible = portrait is CanvasItem and (portrait as CanvasItem).visible
	if ancient_visible and ancient_portrait is TextureRect and ancient_portrait.texture is Texture2D:
		var ancient_path = _resolve_texture_source_path(ancient_portrait, ancient_portrait.texture)
		if ancient_path != "":
			return ancient_path
	if portrait_visible and portrait is TextureRect and portrait.texture is Texture2D:
		var portrait_path = _resolve_texture_source_path(portrait, portrait.texture)
		if portrait_path != "":
			return portrait_path
	var ancestor = card_root
	while ancestor != null:
		var model = ancestor.get("Model")
		var model_path = _extract_model_portrait_path(model)
		if model_path != "":
			return model_path
		ancestor = ancestor.get_parent()
	var full_art_layer = _get_full_art_layer(card_root)
	if full_art_layer is TextureRect and bool(full_art_layer.get_meta(META_FULL_ART_ACTIVE, false)):
		var full_art_owner = String(full_art_layer.get_meta(META_FULL_ART_OWNER_PATH, ""))
		if full_art_owner != "":
			return full_art_owner
	if ancient_visible:
		return ""
	if portrait_visible:
		return ""
	if ancient_portrait is TextureRect and ancient_portrait.texture is Texture2D:
		var ancient_hidden_path = _resolve_texture_source_path(ancient_portrait, ancient_portrait.texture)
		if ancient_hidden_path != "":
			return ancient_hidden_path
	if portrait is TextureRect and portrait.texture is Texture2D:
		var portrait_hidden_path = _resolve_texture_source_path(portrait, portrait.texture)
		if portrait_hidden_path != "":
			return portrait_hidden_path
	return ""


func _refresh_portrait_node(texture_rect) -> void:
	var current_texture = texture_rect.texture
	if current_texture == null:
		return

	var card_root = _find_card_root(texture_rect)
	var node_name = String(texture_rect.name)
	if card_root != null:
		var portrait = _find_named_descendant(card_root, "Portrait")
		var ancient_portrait = _find_named_descendant(card_root, "AncientPortrait")
		var portrait_visible = portrait is CanvasItem and (portrait as CanvasItem).visible
		var ancient_visible = ancient_portrait is CanvasItem and (ancient_portrait as CanvasItem).visible
		if node_name == "Portrait" and !portrait_visible and ancient_visible:
			var original_texture = texture_rect.get_meta(META_ORIGINAL_TEXTURE, null)
			if original_texture is Texture2D:
				texture_rect.texture = original_texture
			texture_rect.set_meta(META_SOURCE_PATH, "")
			texture_rect.set_meta(META_OVERRIDE_ACTIVE, false)
			return
		if node_name == "AncientPortrait" and !ancient_visible:
			var original_texture = texture_rect.get_meta(META_ORIGINAL_TEXTURE, null)
			if original_texture is Texture2D:
				texture_rect.texture = original_texture
			texture_rect.set_meta(META_SOURCE_PATH, "")
			texture_rect.set_meta(META_OVERRIDE_ACTIVE, false)
			return
		var full_art_layer = _get_full_art_layer(card_root)
		if full_art_layer is TextureRect and bool(full_art_layer.get_meta(META_FULL_ART_ACTIVE, false)):
			if ancient_visible and !portrait_visible:
				_clear_custom_full_art_layer(card_root)
			else:
				var owner_path = String(full_art_layer.get_meta(META_FULL_ART_OWNER_PATH, ""))
				var card_root_source_path = _get_card_root_source_path(card_root)
				if owner_path == "" or (card_root_source_path != "" and card_root_source_path != owner_path):
					_clear_custom_full_art_layer(card_root)

	if node_name == FULL_ART_LAYER_NAME and bool(texture_rect.get_meta(META_FULL_ART_ACTIVE, false)):
		var owner_path = String(texture_rect.get_meta(META_FULL_ART_OWNER_PATH, ""))
		var resolved_card_path = _resolve_texture_source_path(texture_rect, current_texture)
		if owner_path == "" or (resolved_card_path != "" and resolved_card_path != owner_path):
			var mismatch_root = _find_card_root(texture_rect)
			_clear_custom_full_art_layer(mismatch_root)
			return

	var card_root_source_path = _get_card_root_source_path(card_root)
	var current_path = card_root_source_path if card_root_source_path != "" else _resolve_texture_source_path(texture_rect, current_texture)
	var stored_source_path = String(texture_rect.get_meta(META_SOURCE_PATH, ""))

	if current_path != "" and _looks_like_card_art_source(current_path):
		var current_root = _find_card_root(texture_rect)
		var full_art_layer = _get_full_art_layer(current_root)
		if full_art_layer is TextureRect and bool(full_art_layer.get_meta(META_FULL_ART_ACTIVE, false)):
			var owner_path = String(full_art_layer.get_meta(META_FULL_ART_OWNER_PATH, ""))
			if owner_path != "" and owner_path != current_path:
				_clear_custom_full_art_layer(current_root)
		if stored_source_path != current_path:
			if String(texture_rect.name) == "Portrait":
				_restore_full_art_state(texture_rect)
			texture_rect.set_meta(META_SOURCE_PATH, current_path)
			texture_rect.set_meta(META_SOURCE_SIZE, Vector2i(current_texture.get_width(), current_texture.get_height()))
			texture_rect.set_meta(META_ORIGINAL_TEXTURE, current_texture)
			texture_rect.set_meta(META_OVERRIDE_ACTIVE, false)
			stored_source_path = current_path
		elif !texture_rect.has_meta(META_ORIGINAL_TEXTURE) or bool(texture_rect.get_meta(META_OVERRIDE_ACTIVE, false)):
			texture_rect.set_meta(META_ORIGINAL_TEXTURE, current_texture)
			texture_rect.set_meta(META_SOURCE_SIZE, Vector2i(current_texture.get_width(), current_texture.get_height()))
			texture_rect.set_meta(META_OVERRIDE_ACTIVE, false)
	elif stored_source_path == "":
		return

	var override_texture = _get_override_texture(stored_source_path)
	if override_texture != null:
		var entry = _manifest.get(stored_source_path, null)
		var display_mode = String(entry.get("display_mode", DISPLAY_MODE_DEFAULT)) if entry is Dictionary else DISPLAY_MODE_DEFAULT
		if card_root != null and node_name == "AncientPortrait":
			var current_ancient = _find_named_descendant(card_root, "AncientPortrait")
			if current_ancient is CanvasItem and !(current_ancient as CanvasItem).visible:
				return
		if card_root != null and node_name == "Portrait":
			var current_portrait = _find_named_descendant(card_root, "Portrait")
			var current_full_art_layer = _get_full_art_layer(card_root)
			var current_full_art_active = current_full_art_layer is TextureRect and bool(current_full_art_layer.get_meta(META_FULL_ART_ACTIVE, false))
			if current_portrait is CanvasItem and !(current_portrait as CanvasItem).visible and !current_full_art_active:
				return
		if display_mode == DISPLAY_MODE_FULL_ART and node_name == "Portrait":
			if _apply_full_art_state(texture_rect, stored_source_path, override_texture):
				texture_rect.set_meta(META_OVERRIDE_ACTIVE, true)
				return
			_restore_full_art_state(texture_rect)
		if node_name == "Portrait":
			_restore_full_art_state(texture_rect)
		if texture_rect.texture != override_texture:
			texture_rect.texture = override_texture
			texture_rect.set_meta(META_OVERRIDE_ACTIVE, true)
		return

	if node_name == "Portrait":
		_restore_full_art_state(texture_rect)

	if bool(texture_rect.get_meta(META_OVERRIDE_ACTIVE, false)):
		var original_texture = texture_rect.get_meta(META_ORIGINAL_TEXTURE, null)
		if original_texture is Texture2D:
			texture_rect.texture = original_texture
		texture_rect.set_meta(META_OVERRIDE_ACTIVE, false)


func _get_override_texture(source_path: String):
	if !_manifest.has(source_path):
		return null

	if _override_texture_cache.has(source_path):
		return _override_texture_cache[source_path]

	var entry = _manifest[source_path]
	if !(entry is Dictionary):
		return null
	var display_mode = String(entry.get("display_mode", DISPLAY_MODE_DEFAULT))

	if _is_animated_entry(entry):
		var frame_paths = entry.get("source_frame_paths", entry.get("frame_paths", [])) if display_mode == DISPLAY_MODE_FULL_ART else entry.get("frame_paths", [])
		var frame_delays = entry.get("frame_delays", [])
		if !(frame_paths is Array) or frame_paths.is_empty():
			return null

		var loaded_frames: Array = []
		for index in range(frame_paths.size()):
			var frame_path = String(frame_paths[index])
			var frame_image = load_image_from_file(ProjectSettings.globalize_path(frame_path))
			if frame_image == null:
				continue
			if display_mode == DISPLAY_MODE_FULL_ART:
				frame_image = trim_transparent_margins(frame_image)
				frame_image = build_full_art_preview(source_path, frame_image, Vector2i.ZERO, FULL_ART_ANIMATED_ZOOM_BOOST)
				if frame_image == null:
					continue
			loaded_frames.append({
				"texture": ImageTexture.create_from_image(frame_image),
				"delay": max(0.02, float(frame_delays[index]) if index < frame_delays.size() else 0.1)
			})

		if loaded_frames.is_empty():
			_remove_entry_files(entry)
			_manifest.erase(source_path)
			_save_manifest()
			return null

		var animated_texture := AnimatedTexture.new()
		animated_texture.frames = loaded_frames.size()
		animated_texture.speed_scale = 1.0
		for index in range(loaded_frames.size()):
			var frame_entry = loaded_frames[index]
			animated_texture.set_frame_texture(index, frame_entry["texture"])
			animated_texture.set_frame_duration(index, frame_entry["delay"])

		_override_texture_cache[source_path] = animated_texture
		return animated_texture

	if !entry.has("override_path"):
		return null

	var override_path = String(entry["override_path"])
	var image_source_path = String(entry.get("edit_source_path", override_path)) if display_mode == DISPLAY_MODE_FULL_ART else override_path
	var image = load_image_from_file(ProjectSettings.globalize_path(image_source_path))
	if image == null:
		_manifest.erase(source_path)
		_save_manifest()
		return null
	if display_mode == DISPLAY_MODE_FULL_ART:
		image = build_full_art_preview(source_path, image)
		if image == null:
			return null

	var override_texture = ImageTexture.create_from_image(image)
	_override_texture_cache[source_path] = override_texture
	return override_texture


func _attach_overlay(screen) -> void:
	if screen == null or !is_instance_valid(screen):
		return
	if screen.get_node_or_null("CardArtEditorOverlay") != null:
		return

	var overlay = _overlay_scene.instantiate()
	overlay.name = "CardArtEditorOverlay"
	screen.add_child(overlay)


func _is_portrait_node(node) -> bool:
	if !(node is TextureRect):
		return false
	var node_name = String(node.name)
	return node_name == "Portrait" or node_name == "AncientPortrait"


func _looks_like_card_art_source(path: String) -> bool:
	return path.begins_with(MANAGED_TEXTURE_PREFIX) or path.begins_with(CARD_ATLAS_PREFIX)


func _resolve_texture_source_path(texture_rect, current_texture: Texture2D) -> String:
	var current_path = _normalize_source_path(String(current_texture.resource_path))
	if current_path != "" and _looks_like_card_art_source(current_path):
		return current_path

	var ancestor = texture_rect
	while ancestor != null:
		var model = ancestor.get("Model")
		var model_path = _extract_model_portrait_path(model)
		if model_path != "":
			return model_path
		ancestor = ancestor.get_parent()

	return current_path


func _extract_model_portrait_path(model) -> String:
	if model == null:
		return ""

	var portrait_path_variant = model.get("PortraitPath")
	if portrait_path_variant != null:
		var portrait_path = _normalize_source_path(String(portrait_path_variant))
		if portrait_path != "" and _looks_like_card_art_source(portrait_path):
			return portrait_path

	var all_portrait_paths = model.get("AllPortraitPaths")
	if all_portrait_paths is Array:
		for portrait_entry in all_portrait_paths:
			var normalized_path = _normalize_source_path(String(portrait_entry))
			if normalized_path != "" and _looks_like_card_art_source(normalized_path):
				return normalized_path

	return ""


func _normalize_source_path(path: String) -> String:
	if path == "":
		return ""

	if path.begins_with(MANAGED_TEXTURE_PREFIX):
		return path

	if path.begins_with(CARD_ATLAS_PREFIX) and path.ends_with(".tres"):
		var sprite_path = path.trim_prefix(CARD_ATLAS_PREFIX)
		sprite_path = sprite_path.trim_suffix(".tres")
		var fallback_path = "%s%s.png" % [MANAGED_TEXTURE_PREFIX, sprite_path]
		if ResourceLoader.exists(fallback_path):
			return fallback_path

	return path


func _ensure_storage() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(STORAGE_IMAGE_DIR))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(STORAGE_EDIT_SOURCE_DIR))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(STORAGE_GIF_TEMP_DIR))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(STORAGE_PCK_TEMP_DIR))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(GIF_TOOL_USER_PATH.get_base_dir()))


func _load_manifest() -> void:
	var absolute_manifest_path = ProjectSettings.globalize_path(STORAGE_MANIFEST_PATH)
	if !FileAccess.file_exists(absolute_manifest_path):
		_manifest = {}
		return

	var file = FileAccess.open(absolute_manifest_path, FileAccess.READ)
	if file == null:
		_manifest = {}
		return

	var parsed = JSON.parse_string(file.get_as_text())
	if parsed is Dictionary:
		_manifest = parsed
	else:
		_manifest = {}


func _save_manifest() -> void:
	var absolute_manifest_path = ProjectSettings.globalize_path(STORAGE_MANIFEST_PATH)
	var file = FileAccess.open(absolute_manifest_path, FileAccess.WRITE)
	if file == null:
		return
	file.store_string(JSON.stringify(_manifest, "\t"))


func _safe_file_stem(source_path: String) -> String:
	var stem = source_path.to_lower()
	stem = stem.replace("res://", "")
	stem = stem.replace("/", "_")
	stem = stem.replace("\\", "_")
	stem = stem.replace(":", "_")
	stem = stem.replace(".", "_")
	return stem
