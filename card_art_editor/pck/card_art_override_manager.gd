extends Node

const STORAGE_ROOT := "user://card_art_editor"
const STORAGE_IMAGE_DIR := STORAGE_ROOT + "/overrides"
const STORAGE_EDIT_SOURCE_DIR := STORAGE_ROOT + "/edit_sources"
const STORAGE_GIF_TEMP_DIR := STORAGE_ROOT + "/gif_temp"
const STORAGE_MANIFEST_PATH := STORAGE_ROOT + "/manifest.json"
const GIF_TOOL_RES_PATH := "res://mods/card_art_editor/extract_gif_frames.ps1"
const GIF_TOOL_USER_PATH := STORAGE_ROOT + "/tools/extract_gif_frames.ps1"
const BUNDLE_VERSION := 1
const MANAGED_TEXTURE_PREFIX := "res://images/packed/card_portraits/"
const CARD_ATLAS_PREFIX := "res://images/atlases/card_atlas.sprites/"
const DEFAULT_LANDSCAPE_SIZE := Vector2i(1000, 760)
const DEFAULT_PORTRAIT_SIZE := Vector2i(606, 852)
const REFRESH_INTERVAL := 0.0

const META_SOURCE_PATH := "_card_art_source_path"
const META_SOURCE_SIZE := "_card_art_source_size"
const META_ORIGINAL_TEXTURE := "_card_art_original_texture"
const META_OVERRIDE_ACTIVE := "_card_art_override_active"

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
		var frame_paths = entry.get("frame_paths", [])
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
			"type": String(entry.get("type", "static"))
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
			var animated_result = save_animated_override_images(source_path, imported_images, imported_delays)
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
			var result = save_override_image(source_path, image)
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


func save_override_image(source_path: String, image) -> Dictionary:
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
	return _save_static_override_data(source_path, normalized_image, image, 1.0, 0.0, 0.0)


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
		var result = save_animated_override_images(source_path, adjusted_images, delays)
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

	return _save_static_override_data(source_path, adjusted_image, source_image, zoom, offset_x, offset_y)


func build_adjusted_preview(source_path: String, source_image, zoom: float, offset_x: float, offset_y: float):
	if source_image == null:
		return null
	var target_size = get_target_size_for_source_path(source_path)
	return normalize_image_with_adjustment(source_image, target_size, zoom, offset_x, offset_y)


func save_gif_override_from_file(source_path: String, import_path: String) -> Dictionary:
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
		Array(extract_result.get("delays", []))
	)
	var temp_dir = String(extract_result.get("temp_dir", ""))
	if temp_dir != "":
		_delete_directory_recursive(temp_dir)
	return save_result


func save_animated_override_images(source_path: String, images: Array, delays: Array) -> Dictionary:
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
	var frame_delays: Array = []

	_remove_entry_files(_manifest.get(source_path, null))

	for index in range(images.size()):
		var normalized_image = normalize_image(images[index], target_size)
		if normalized_image == null:
			continue
		var frame_path = "%s/%s_anim_%03d.png" % [STORAGE_IMAGE_DIR, safe_stem, index]
		var absolute_frame_path = ProjectSettings.globalize_path(frame_path)
		var save_error = normalized_image.save_png(absolute_frame_path)
		if save_error != OK:
			continue
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
		"frame_delays": frame_delays,
		"width": target_size.x,
		"height": target_size.y,
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


func _save_static_override_data(source_path: String, normalized_image, edit_source_image, zoom: float, offset_x: float, offset_y: float) -> Dictionary:
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


func refresh_all_portraits() -> void:
	_refresh_tracked_portraits()


func apply_override_to_texture_rect(texture_rect) -> void:
	if texture_rect == null:
		return
	_refresh_portrait_node(texture_rect)


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


func _refresh_portrait_node(texture_rect) -> void:
	var current_texture = texture_rect.texture
	if current_texture == null:
		return

	var current_path = _resolve_texture_source_path(texture_rect, current_texture)
	var stored_source_path = String(texture_rect.get_meta(META_SOURCE_PATH, ""))

	if current_path != "" and _looks_like_card_art_source(current_path):
		if stored_source_path != current_path:
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
		if texture_rect.texture != override_texture:
			texture_rect.texture = override_texture
			texture_rect.set_meta(META_OVERRIDE_ACTIVE, true)
		return

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

	if _is_animated_entry(entry):
		var frame_paths = entry.get("frame_paths", [])
		var frame_delays = entry.get("frame_delays", [])
		if !(frame_paths is Array) or frame_paths.is_empty():
			return null

		var loaded_frames: Array = []
		for index in range(frame_paths.size()):
			var frame_path = String(frame_paths[index])
			var frame_image = load_image_from_file(ProjectSettings.globalize_path(frame_path))
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
	var image = load_image_from_file(ProjectSettings.globalize_path(override_path))
	if image == null:
		_manifest.erase(source_path)
		_save_manifest()
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
