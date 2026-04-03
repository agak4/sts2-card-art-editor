using System;
using System.Runtime.CompilerServices;
using HarmonyLib;
using MegaCrit.Sts2.Core.Nodes.Screens;

namespace CardArtEditorBootstrap
{
	// Token: 0x02000003 RID: 3
	[HarmonyPatch(typeof(NInspectCardScreen), "_Ready")]
	internal static class InspectCardScreenReadyPatch
	{
		// Token: 0x0600000B RID: 11 RVA: 0x00002875 File Offset: 0x00000A75
		[NullableContext(1)]
		private static void Postfix(NInspectCardScreen __instance)
		{
			Bootstrap.OnInspectCardScreenReady(__instance);
		}
	}
}
