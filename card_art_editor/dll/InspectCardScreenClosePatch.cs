using System;
using System.Runtime.CompilerServices;
using HarmonyLib;
using MegaCrit.Sts2.Core.Nodes.Screens;

namespace CardArtEditorBootstrap
{
	// Token: 0x02000005 RID: 5
	[HarmonyPatch(typeof(NInspectCardScreen), "Close")]
	internal static class InspectCardScreenClosePatch
	{
		// Token: 0x0600000D RID: 13 RVA: 0x00002885 File Offset: 0x00000A85
		[NullableContext(1)]
		private static void Prefix(NInspectCardScreen __instance)
		{
			Bootstrap.UpdateInspectCardMetadata(__instance);
		}
	}
}
